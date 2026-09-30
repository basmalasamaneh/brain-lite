import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { db, pool, memoriesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { GetMemoryResponse } from "@workspace/api-zod";
import { logger } from "./logger";
import { providerDiagnostic } from "./gemini-provider";
import { buildEmbeddingText, cosine, EMBEDDING_DIMENSIONS, exactBoost, retryDelay, SIMILARITY_THRESHOLD, structuredIntent } from "./semantic-utils";

type Memory = typeof memoriesTable.$inferSelect;
export type RankedMemory = { memory: Memory; relevance: number };
export type SearchFilters = { type?: string; date_from?: string; date_to?: string; timezone?: string };
let mode: "pgvector" | "double_precision_array" = "double_precision_array";
let initialization: Promise<void> | undefined;
let workerStarted = false;
const cache = new Map<string, { vector: number[]; expires: number }>();
const pendingQueries = new Map<string, Promise<number[]>>();
const CACHE_TTL = 3 * 60 * 1000;
const CACHE_MAX = 200;
const CACHE_PER_USER = 20;

export function embeddingModel() { return process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001"; }

export async function embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("EMBEDDINGS_NOT_CONFIGURED");
  const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } } });
  const response = await client.models.embedContent({
    model: embeddingModel(), contents: text,
    config: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value)) || !values.some((value) => value !== 0)) {
    throw new Error("INVALID_EMBEDDING");
  }
  return values;
}

export function initializeSemanticSearch(): Promise<void> {
  if (!initialization) initialization = (async () => {
    let migration: string | undefined;
    for (const path of [
      new URL("./semantic-migration.sql", import.meta.url),
      new URL("../../../../lib/db/migrations/0003_semantic_search.sql", import.meta.url),
    ]) {
      try { migration = await readFile(path, "utf8"); break; } catch { /* Source vs bundled layout */ }
    }
    if (!migration) throw new Error("SEMANTIC_MIGRATION_MISSING");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(768001)");
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const result = await pool.query(`SELECT t.typname,format_type(a.atttypid,a.atttypmod) AS storage_type
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
      WHERE n.nspname='public' AND c.relname='memories' AND a.attname='embedding' AND NOT a.attisdropped`);
    const storage = result.rows[0];
    if (storage?.typname === "vector" && storage.storage_type === `vector(${EMBEDDING_DIMENSIONS})`) mode = "pgvector";
    else if (storage?.typname === "_float8" && storage.storage_type === "double precision[]") mode = "double_precision_array";
    else throw new Error("UNSUPPORTED_EMBEDDING_STORAGE_OR_DIMENSIONS");
    // Model changes invalidate old vectors; tasks still retry durably.
    await pool.query(`UPDATE memory_embedding_jobs SET version=version+1, model=$1,
      attempts=0, next_attempt_at=now(), lease_until=NULL, lease_token=NULL,last_error=NULL
      WHERE model IS NOT NULL AND model<>$1`, [embeddingModel()]);
    // First-time jobs must retain attempts/backoff across process restarts.
    await pool.query("UPDATE memory_embedding_jobs SET model=$1 WHERE model IS NULL", [embeddingModel()]);
    logger.info({ mode, model: embeddingModel(), dimensions: EMBEDDING_DIMENSIONS }, "Semantic indexing initialized");
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

export function publicMemory(memory: Memory) {
  return GetMemoryResponse.parse({ ...memory, created_at: memory.created_at.toISOString() });
}

export async function indexingStatus(userId: string) {
  await initializeSemanticSearch();
  const { rows } = await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE j.indexed_version=j.version AND m.embedding IS NOT NULL)::int AS indexed,
    count(*) FILTER (WHERE j.indexed_version<>j.version AND j.last_error IS NULL)::int AS pending,
    count(*) FILTER (WHERE j.indexed_version<>j.version AND j.last_error IS NOT NULL)::int AS failed
    FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id WHERE m.user_id=$1`, [userId]);
  return { ...rows[0], mode };
}

export async function reindex(userId: string) {
  await initializeSemanticSearch();
  await pool.query(`UPDATE memory_embedding_jobs j SET version=version+1, attempts=0,
    next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL
    FROM memories m WHERE j.memory_id=m.id AND m.user_id=$1`, [userId]);
  return indexingStatus(userId);
}

/** Single-job lease with a version fence makes edits/reindex/delete safe during an API request. */
export async function processEmbeddingBatch(): Promise<number> {
  await initializeSemanticSearch();
  let processed = 0;
  for (let batch = 0; batch < 2; batch++) {
    const leaseToken = randomUUID();
    const result = await pool.query(`WITH candidate AS (
      SELECT memory_id FROM memory_embedding_jobs
      WHERE indexed_version<>version AND next_attempt_at<=now()
        AND (lease_until IS NULL OR lease_until<now())
      ORDER BY next_attempt_at,memory_id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE memory_embedding_jobs j SET lease_until=now()+interval '90 seconds',lease_token=$1
      FROM candidate c WHERE j.memory_id=c.memory_id
      RETURNING j.memory_id,j.version,j.attempts`, [leaseToken]);
    const job = result.rows[0];
    if (!job) break;
    const [memory] = await db.select().from(memoriesTable).where(eq(memoriesTable.id, job.memory_id));
    if (!memory) continue;
    try {
      const vector = await embed(buildEmbeddingText(memory), "RETRIEVAL_DOCUMENT");
      // Atomically fence an old task before updating the memory. Lock order
      // matches the memory update trigger (memory first, then job).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM memories WHERE id=$1 AND user_id=$2 FOR UPDATE", [memory.id, memory.userId]);
        const fence = await client.query(`UPDATE memory_embedding_jobs SET indexed_version=version,
          attempts=0, last_error=NULL, lease_until=NULL,lease_token=NULL,model=$3
          WHERE memory_id=$1 AND version=$2 AND lease_token=$4 AND lease_until>now()
          RETURNING memory_id`, [memory.id, job.version, embeddingModel(), leaseToken]);
        if (fence.rowCount) await client.query(`UPDATE memories SET embedding=$1${mode === "pgvector" ? "::vector" : "::double precision[]"} WHERE id=$2 AND user_id=$3`,
          [mode === "pgvector" ? JSON.stringify(vector) : vector, memory.id, memory.userId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } catch (error) {
      const diagnostic = providerDiagnostic(error);
      const delay = retryDelay(job.attempts);
      await pool.query(`UPDATE memory_embedding_jobs SET attempts=attempts+1,
        last_error=$3, next_attempt_at=now()+($4::double precision*interval '1 millisecond'),lease_until=NULL,lease_token=NULL
        WHERE memory_id=$1 AND version=$2 AND lease_token=$5 AND lease_until>now()`,
      [memory.id, job.version, `${diagnostic.status ?? "unknown"}:${diagnostic.reason}`, delay, leaseToken]);
      logger.warn({ model: embeddingModel(), ...diagnostic }, "Embedding queued for durable retry");
    }
    processed++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return processed;
}

export function startEmbeddingWorker() {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    try { await processEmbeddingBatch(); }
    catch (error) { logger.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Indexing worker unavailable; retrying"); }
    setTimeout(tick, 4000).unref();
  };
  void tick();
}

async function queryEmbedding(userId: string, query: string) {
  const prefix = `${userId}\u0000`;
  const key = `${prefix}${embeddingModel()}\u0000${query.trim().toLocaleLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.vector;
  const pending = pendingQueries.get(key);
  if (pending) return pending;
  const promise = embed(query, "RETRIEVAL_QUERY").then((vector) => {
    for (const [entry, value] of cache) if (value.expires <= Date.now()) cache.delete(entry);
    const ownedKeys = [...cache.keys()].filter((entry) => entry.startsWith(prefix));
    while (ownedKeys.length >= CACHE_PER_USER) cache.delete(ownedKeys.shift()!);
    while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { vector, expires: Date.now() + CACHE_TTL });
    return vector;
  }).finally(() => pendingQueries.delete(key));
  pendingQueries.set(key, promise);
  return promise;
}

function sqlFilters(userId: string, filters: SearchFilters, extra?: { minimumAmount?: number; total?: boolean; upcoming?: boolean; appointmentOnly?: boolean; qualifiers?: string[] }) {
  const values: unknown[] = [userId];
  const clauses = ["m.user_id=$1"];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (filters.type && filters.type !== "all") clauses.push(`m.type=${bind(filters.type)}`);
  const calendar = filters.date_from || filters.date_to ? `brain_memory_local_date(m.event_date,${bind(filters.timezone ?? "UTC")})` : "";
  if (filters.date_from) clauses.push(`${calendar}>=${bind(filters.date_from)}`);
  if (filters.date_to) clauses.push(`${calendar}<=${bind(filters.date_to)}`);
  if (extra?.total) clauses.push("m.amount IS NOT NULL", "m.type='receipt'");
  else if (extra?.appointmentOnly) clauses.push("m.type='appointment'");
  else if (extra?.upcoming) clauses.push("m.type IN ('appointment','task')");
  if (extra?.minimumAmount !== undefined) clauses.push(`m.amount>${bind(extra.minimumAmount)}`);
  if (extra?.total && extra.qualifiers?.length) {
    // Exact normalized tokens, all requested qualifiers, and ownership remain
    // inside the SQL aggregate scope. Never retrieve a global spending total
    // and ask the model to pretend it is a merchant/category total.
    const fields = "concat_ws(' ',m.title,m.summary,m.raw_text,array_to_string(m.tags,' '),array_to_string(m.people,' '))";
    const normalized = `regexp_replace(translate(lower(${fields}),'أإآى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','اااي01234567890123456789'),'[ً-ٰٟ]','','g')`;
    clauses.push(`regexp_split_to_array(${normalized},'[^[:alnum:]ء-ي]+') @> ${bind(extra.qualifiers)}::text[]`);
  }
  return { values, where: clauses.join(" AND ") };
}

async function rankVector(userId: string, vector: number[], filters: SearchFilters, query?: string, exclude?: number, limit = 8): Promise<RankedMemory[]> {
  const scoped = sqlFilters(userId, filters);
  if (exclude !== undefined) { scoped.values.push(exclude); scoped.where += ` AND m.id<>$${scoped.values.length}`; }
  let scores: { id: number; embedding?: number[]; relevance?: number }[];
  if (mode === "pgvector") {
    const values = [...scoped.values, JSON.stringify(vector)];
    const vectorParam = `$${values.length}::vector`;
    scores = (await pool.query(`SELECT m.id, 1-(m.embedding <=> ${vectorParam}) AS relevance
      FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
      WHERE ${scoped.where} AND m.embedding IS NOT NULL AND j.indexed_version=j.version
      ORDER BY m.embedding <=> ${vectorParam} LIMIT 40`, values)).rows;
  } else {
    // Float-array fallback deliberately only reads the logged-in user's vectors.
    scores = (await pool.query(`SELECT m.id,m.embedding FROM memories m
      JOIN memory_embedding_jobs j ON j.memory_id=m.id
      WHERE ${scoped.where} AND m.embedding IS NOT NULL AND j.indexed_version=j.version`, scoped.values)).rows;
    scores = scores.map((row) => {
      if (!validStoredVector(row.embedding)) throw new Error("INVALID_STORED_EMBEDDING_DIMENSIONS");
      return { id: row.id, relevance: cosine(vector, row.embedding!) };
    });
  }
  const ranks = new Map(scores.map((row) => [row.id, row.relevance ?? 0]));
  // Exact hybrid candidates also include not-yet-indexed memories. Parameterized
  // scope is in the SQL, not a post-query application-side ownership filter.
  const candidates = query
    ? (await pool.query(`SELECT m.id FROM memories m WHERE ${scoped.where}`, scoped.values)).rows.map((row: { id: number }) => row.id)
    : [...ranks.keys()];
  if (!candidates.length) return [];
  const memories = await db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), inArray(memoriesTable.id, candidates)));
  return memories.map((memory) => ({ memory,
    relevance: Math.max(0, Math.min(1, Math.max(ranks.get(memory.id) ?? 0, query ? exactBoost(memory, query) : 0))),
  })).filter((row) => row.relevance >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.relevance - a.relevance || b.memory.id - a.memory.id).slice(0, limit);
}

export async function relatedMemories(userId: string, query: string, filters: SearchFilters = {}) {
  await initializeSemanticSearch();
  return rankVector(userId, await queryEmbedding(userId, query), filters, query);
}

export async function similarMemories(userId: string, id: number): Promise<RankedMemory[] | null> {
  await initializeSemanticSearch();
  const { rows } = await pool.query(`SELECT m.embedding,j.indexed_version=j.version AS ready FROM memories m
    JOIN memory_embedding_jobs j ON j.memory_id=m.id WHERE m.id=$1 AND m.user_id=$2`, [id, userId]);
  if (!rows.length) return null;
  if (!rows[0].embedding || !rows[0].ready) return [];
  const vector = mode === "pgvector" ? JSON.parse(rows[0].embedding) : rows[0].embedding;
  if (!validStoredVector(vector)) throw new Error("INVALID_STORED_EMBEDDING_DIMENSIONS");
  return rankVector(userId, vector, {}, undefined, id, 3);
}

function validStoredVector(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS &&
    vector.every((value) => typeof value === "number" && Number.isFinite(value));
}

export async function retrieveForQuestion(userId: string, question: string, timezone = "UTC") {
  await initializeSemanticSearch();
  const exists = await pool.query("SELECT id FROM memories WHERE user_id=$1 LIMIT 1", [userId]);
  if (!exists.rowCount) return { related: [] as RankedMemory[], aggregate: undefined };
  const intent = structuredIntent(question, new Date(), timezone);
  let related: RankedMemory[] = intent.active ? [] : await relatedMemories(userId, question, {
    date_from: intent.from, date_to: intent.to, type: intent.total ? "receipt" : undefined, timezone,
  });
  let aggregate: unknown;
  if (intent.active) {
    const scope = sqlFilters(userId, { date_from: intent.from, date_to: intent.to, timezone }, intent);
    const currency = "coalesce(nullif(upper(trim(m.currency)),''),'unspecified')";
    const grouped = await pool.query(`SELECT ${currency} AS currency,
      count(*)::int AS count,sum(m.amount) AS total_amount
      FROM memories m WHERE ${scope.where} GROUP BY ${currency} ORDER BY currency`, scope.values);
    const sample = await pool.query(`SELECT m.id FROM memories m WHERE ${scope.where}
      ORDER BY m.event_date NULLS LAST,m.id LIMIT 8`, scope.values);
    const ids = sample.rows.map((row: { id: number }) => row.id);
    const rows = ids.length ? await db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), inArray(memoriesTable.id, ids))) : [];
    related = rows.map((memory) => ({ memory, relevance: 1 }));
    aggregate = { kind: intent.total ? "spending_totals" : "scheduled_events",
      date_from: intent.from ?? null, date_to: intent.to ?? null, timezone,
      minimum_amount_exclusive: intent.minimumAmount ?? null,
      scope: { memory_types: intent.total ? ["receipt"] : intent.appointmentOnly ? ["appointment"] : ["appointment", "task"],
        exact_all_qualifier_terms: intent.qualifiers, qualified: intent.qualifiers.length > 0,
        matching_rule: "Every qualifier must occur as an exact normalized token in title, summary, tags, people or raw text. No matches means no answer; never fall back to all receipts." },
      groups: grouped.rows, count: grouped.rows.reduce((sum, row) => sum + row.count, 0),
      explanation: "Computed in SQL over ALL matching owned memories, not only displayed source examples. Report EACH currency separately, including unspecified as unknown currency; NEVER sum, convert, or invent a combined total. Offset timestamps are converted to the supplied timezone; date-only and floating local dates are retained. Calendar weeks run Monday-Sunday." };
  }
  return { related, aggregate };
}