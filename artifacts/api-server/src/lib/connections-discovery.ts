import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { canonicalPair, compatibleDuplicateTypes, CONNECTION_PROMPT, CONNECTION_THRESHOLD, FORGOTTEN_AR, FORGOTTEN_EN, parseProposedLinks } from "./connections-utils";
import { ownerTransaction } from "./connections";
import { embeddingStorageMode } from "./semantic-search";
import { cosine, retryDelay } from "./semantic-utils";
import { geminiModel, providerDiagnostic } from "./gemini-provider";
import { reserveAiBudget } from "./ai-budget";
import { deletingUsers } from "./brain-state";
import { logger } from "./logger";

type Snapshot = {
  id: number; user_id: string; version: string; title: string; summary: string | null;
  raw_text: string; transcript: string | null; type: string; people: string[];
  tags: string[]; event_date: string | null; amount: number | null; currency: string | null;
  embedding: string | number[]; relevance?: number;
};
function vector(row: Snapshot): number[] { return typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding; }
function compact(row: Snapshot) {
  return { id: row.id, title: row.title, summary: row.summary, type: row.type, people: row.people,
    tags: row.tags, event_date: row.event_date, amount: row.amount, currency: row.currency,
    text: row.raw_text.slice(0, 12000), transcript: row.transcript?.slice(0, 12000) };
}
/** SQL ownership, pair exclusion and readiness precede nearest-neighbour LIMIT.
 * The array fallback reads only this owner's vectors, never global vectors. */
export async function connectionCandidates(userId: string, source: Snapshot, forgotten = false) {
  const where = `m.user_id=$1 AND m.id<>$2 AND m.embedding IS NOT NULL AND j.indexed_version=j.version
    AND NOT EXISTS(SELECT 1 FROM memory_links l WHERE l.user_id=$1
      AND l.memory_a_id=least($2,m.id) AND l.memory_b_id=greatest($2,m.id))
    ${forgotten ? "AND m.created_at>=now()-interval '14 days'" : ""}`;
  if (embeddingStorageMode() === "pgvector") {
    const result = await pool.query(`SELECT m.*,j.version,1-(m.embedding <=> $3::vector) AS relevance
      FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id WHERE ${where}
      AND 1-(m.embedding <=> $3::vector)>=$4 ORDER BY m.embedding <=> $3::vector,m.id LIMIT 6`,
    [userId, source.id, JSON.stringify(vector(source)), CONNECTION_THRESHOLD]);
    return result.rows as Snapshot[];
  }
  const result = await pool.query(`SELECT m.*,j.version FROM memories m
    JOIN memory_embedding_jobs j ON j.memory_id=m.id WHERE ${where}`, [userId, source.id]);
  return (result.rows as Snapshot[]).map((row) => ({ ...row, relevance: cosine(vector(source), vector(row)) }))
    .filter((row) => row.relevance >= CONNECTION_THRESHOLD).sort((a, b) => b.relevance - a.relevance || a.id - b.id).slice(0, 6);
}

/** Explicit scans can override auto-off; every row retains the indexed version.
 * Small, staggered batches plus a persisted cursor rotate over older memories. */
export async function queueDiscovery(userId: string, explicit: boolean, client?: PoolClient) {
  const run = async (tx: PoolClient) => {
    await tx.query("INSERT INTO connection_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
    const settings = (await tx.query("SELECT * FROM connection_settings WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
    if (!explicit && !settings.automatic) return;
    const batch = await tx.query(`SELECT m.id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
      WHERE m.user_id=$1 AND ($3 OR (m.embedding IS NOT NULL AND j.version=j.indexed_version))
      ORDER BY CASE WHEN m.id>$2 THEN 0 ELSE 1 END,m.id LIMIT 24`, [userId, settings.scan_cursor, explicit]);
    for (const [index, memory] of batch.rows.entries()) {
      await tx.query(`INSERT INTO connection_discovery_jobs(memory_id,user_id,version,explicit,next_attempt_at)
        VALUES($1,$2,$3,$4,now()+($5*interval '8 seconds'))
        ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,generation=connection_discovery_jobs.generation+1,
          explicit=connection_discovery_jobs.explicit OR EXCLUDED.explicit,forgotten=false,completed=false,
          attempts=0,next_attempt_at=EXCLUDED.next_attempt_at,lease_until=NULL,lease_token=NULL,last_error=NULL`,
      [memory.id, userId, memory.version, explicit, index]);
    }
    // Exactly one old idea per weekly pass; candidates must be recent.
    if (!explicit) {
      const idea = (await tx.query(`SELECT m.id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
        WHERE m.user_id=$1 AND m.type='idea' AND m.created_at<now()-interval '30 days'
          AND m.embedding IS NOT NULL AND j.version=j.indexed_version
        ORDER BY m.created_at,m.id LIMIT 1`, [userId])).rows[0];
      if (idea) await tx.query(`INSERT INTO connection_discovery_jobs(memory_id,user_id,version,forgotten)
        VALUES($1,$2,$3,true) ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,
          generation=connection_discovery_jobs.generation+1,forgotten=true,completed=false,attempts=0,
          next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL`, [idea.id, userId, idea.version]);
    }
    await tx.query(`UPDATE connection_settings SET scan_cursor=$2,
      next_weekly_at=CASE WHEN $3 THEN next_weekly_at ELSE now()+interval '7 days' END,
      scheduler_attempts=CASE WHEN $3 THEN scheduler_attempts ELSE 0 END,
      scheduler_retry_at=CASE WHEN $3 THEN scheduler_retry_at ELSE now() END,
      last_scheduler_error=CASE WHEN $3 THEN last_scheduler_error ELSE NULL END,
      scheduler_lease_until=CASE WHEN $3 THEN scheduler_lease_until ELSE NULL END,
      scheduler_lease_token=CASE WHEN $3 THEN scheduler_lease_token ELSE NULL END WHERE user_id=$1`,
    [userId, batch.rows.at(-1)?.id ?? 0, explicit]);
  };
  if (client) await run(client);
  else await ownerTransaction(userId, run);
}
export async function scheduleWeeklyDiscovery(options?: {
  userIds: string[];
  enqueue?: (userId: string, explicit: boolean, client: PoolClient) => Promise<void>;
}) {
  // New users have a default-on persisted schedule, even without opening Settings.
  await pool.query(`INSERT INTO connection_settings(user_id) SELECT id FROM users
    WHERE $1::varchar[] IS NULL OR id=ANY($1::varchar[]) ON CONFLICT DO NOTHING`, [options?.userIds ?? null]);
  const token = randomUUID();
  const due = await pool.query(`WITH candidates AS (
    SELECT user_id FROM connection_settings WHERE automatic AND next_weekly_at<=now()
      AND scheduler_retry_at<=now() AND (scheduler_lease_until IS NULL OR scheduler_lease_until<now())
      AND ($2::varchar[] IS NULL OR user_id=ANY($2::varchar[]))
    ORDER BY next_weekly_at,user_id FOR UPDATE SKIP LOCKED LIMIT 2)
    UPDATE connection_settings s SET scheduler_lease_until=now()+interval '90 seconds',scheduler_lease_token=$1
    FROM candidates c WHERE s.user_id=c.user_id RETURNING s.user_id,s.scheduler_attempts`, [token, options?.userIds ?? null]);
  for (const { user_id: userId, scheduler_attempts: attempts } of due.rows) {
    try {
      if (deletingUsers.has(userId)) throw new Error("DELETION_IN_PROGRESS");
      await ownerTransaction(userId, async (client) => {
        const current = await client.query(`SELECT user_id FROM connection_settings WHERE user_id=$1 AND automatic
          AND next_weekly_at<=now() AND scheduler_lease_token=$2 AND scheduler_lease_until>now() FOR UPDATE`, [userId, token]);
        if (current.rowCount) await (options?.enqueue ?? queueDiscovery)(userId, false, client);
      });
    } catch (error) {
      // Retry the missed week, do not advance its successful weekly timestamp.
      // Persist per-user backoff so one failing owner cannot monopolize LIMIT 2.
      const diagnostic = providerDiagnostic(error);
      try {
        await pool.query(`UPDATE connection_settings SET scheduler_attempts=scheduler_attempts+1,
          scheduler_retry_at=now()+($3::double precision*interval '1 millisecond'),last_scheduler_error=$4,
          scheduler_lease_until=NULL,scheduler_lease_token=NULL WHERE user_id=$1 AND scheduler_lease_token=$2`,
        [userId, token, retryDelay(attempts), `${diagnostic.status ?? "unknown"}:${diagnostic.reason}`]);
      } catch { logger.warn("Weekly scheduler could not persist retry; claim will expire"); }
      logger.warn(diagnostic, "Weekly discovery scheduling retained for retry");
    }
  }
}
type Job = { memory_id: number; user_id: string; version: string; generation: string; attempts: number; forgotten: boolean; explicit: boolean };
export async function processConnectionJob() {
  const token = randomUUID();
  const result = await pool.query(`WITH candidate AS (
    SELECT d.memory_id FROM connection_discovery_jobs d JOIN memories m ON m.id=d.memory_id AND m.user_id=d.user_id
    JOIN memory_embedding_jobs j ON j.memory_id=m.id
    LEFT JOIN connection_settings s ON s.user_id=d.user_id
    WHERE NOT d.completed AND d.next_attempt_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now())
      AND (d.explicit OR coalesce(s.automatic,true)) AND m.embedding IS NOT NULL
      AND j.version=j.indexed_version AND d.version=j.version
      AND coalesce((SELECT used FROM connection_daily_usage WHERE user_id=d.user_id AND day=(now() AT TIME ZONE 'UTC')::date),0)<3
    ORDER BY d.forgotten DESC,d.next_attempt_at,d.memory_id FOR UPDATE OF d SKIP LOCKED LIMIT 1)
    UPDATE connection_discovery_jobs d SET lease_token=$1,lease_until=now()+interval '90 seconds'
    FROM candidate c WHERE d.memory_id=c.memory_id RETURNING d.*`, [token]);
  const job = result.rows[0] as Job | undefined;
  if (!job) return false;
  if (deletingUsers.has(job.user_id)) {
    await pool.query("UPDATE connection_discovery_jobs SET lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 minute' WHERE memory_id=$1 AND lease_token=$2", [job.memory_id, token]);
    return false;
  }
  try {
    const source = (await pool.query(`SELECT m.*,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
      WHERE m.user_id=$1 AND m.id=$2 AND j.version=$3 AND j.indexed_version=j.version`, [job.user_id, job.memory_id, job.version])).rows[0] as Snapshot | undefined;
    if (!source) throw new Error("STALE_CONNECTION_SOURCE");
    const candidates = await connectionCandidates(job.user_id, source, job.forgotten);
    let links: ReturnType<typeof parseProposedLinks> = [];
    if (candidates.length) {
      if (!await reserveAiBudget(job.user_id, true)) {
        await pool.query(`UPDATE connection_discovery_jobs SET next_attempt_at=date_trunc('hour',now())+interval '1 hour'+interval '10 seconds',
          lease_token=NULL,lease_until=NULL WHERE memory_id=$1 AND generation=$2 AND lease_token=$3`, [job.memory_id, job.generation, token]);
        return false;
      }
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("CONNECTIONS_NOT_CONFIGURED");
      // One provider call for source + all 6 candidates. Retries are durable jobs,
      // not repeated Gemini calls within a user request.
      const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 20000, retryOptions: { attempts: 1 } } });
      const response = await ai.models.generateContent({ model: geminiModel(),
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ source: compact(source), candidates: candidates.map(compact) }) }] }],
        config: { systemInstruction: CONNECTION_PROMPT, responseMimeType: "application/json", maxOutputTokens: 8192 } });
      links = parseProposedLinks(response.text ?? "", new Set(candidates.map((row) => row.id)));
    }
    await ownerTransaction(job.user_id, async (client) => {
      const ids = [source.id, ...candidates.map((row) => row.id)].sort((a, b) => a - b);
      await client.query("SELECT id FROM memories WHERE user_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE", [job.user_id, ids]);
      const ready = (await client.query(`SELECT m.id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
        WHERE m.user_id=$1 AND m.id=ANY($2::int[]) AND j.indexed_version=j.version`, [job.user_id, ids])).rows;
      const versions = new Map(ready.map((row) => [row.id, String(row.version)]));
      if (versions.get(source.id) !== String(source.version)) throw new Error("STALE_CONNECTION_SOURCE");
      const fence = await client.query(`SELECT memory_id FROM connection_discovery_jobs
        WHERE user_id=$1 AND memory_id=$2 AND generation=$3 AND version=$4 AND lease_token=$5 AND lease_until>now() FOR UPDATE`,
      [job.user_id, job.memory_id, job.generation, job.version, token]);
      if (!fence.rowCount) return;
      const settings = await client.query("SELECT automatic FROM connection_settings WHERE user_id=$1 FOR UPDATE", [job.user_id]);
      if (!job.explicit && settings.rows[0]?.automatic === false) {
        await client.query("UPDATE connection_discovery_jobs SET lease_token=NULL,lease_until=NULL WHERE memory_id=$1 AND user_id=$2", [job.memory_id, job.user_id]);
        return;
      }
      await client.query(`INSERT INTO connection_daily_usage(user_id,day) VALUES($1,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`, [job.user_id]);
      const usage = (await client.query("SELECT used FROM connection_daily_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE", [job.user_id])).rows[0];
      let used = usage.used as number;
      for (const link of (job.forgotten ? links.slice(0, 1) : links)) {
        if (used >= 3) break;
        const candidate = candidates.find((row) => row.id === link.other_id)!;
        if (link.relation_type === "duplicate" && !compatibleDuplicateTypes(source.type, candidate.type)) continue;
        if (versions.get(candidate.id) !== String(candidate.version)) continue;
        const [a, b] = canonicalPair(source.id, candidate.id);
        const reason = job.forgotten
          ? (/[ء-ي]/.test(`${source.title} ${source.raw_text}`) ? FORGOTTEN_AR : FORGOTTEN_EN) : link.reason;
        const saved = await client.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
          VALUES($1,$2,$3,'ai','suggested',$4,$5,$6) ON CONFLICT(user_id,memory_a_id,memory_b_id) DO NOTHING RETURNING id`,
        [job.user_id, a, b, link.relation_type, reason, link.confidence]);
        if (saved.rowCount) used++;
      }
      await client.query("UPDATE connection_daily_usage SET used=$2 WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date", [job.user_id, used]);
      await client.query(`UPDATE connection_discovery_jobs SET completed=true,lease_token=NULL,lease_until=NULL,last_error=NULL
        WHERE memory_id=$1 AND user_id=$2 AND generation=$3 AND lease_token=$4`, [job.memory_id, job.user_id, job.generation, token]);
    });
  } catch (error) {
    const diagnostic = providerDiagnostic(error);
    await pool.query(`UPDATE connection_discovery_jobs SET attempts=attempts+1,last_error=$4,
      next_attempt_at=now()+($5::double precision*interval '1 millisecond'),lease_token=NULL,lease_until=NULL
      WHERE memory_id=$1 AND user_id=$2 AND generation=$3 AND lease_token=$6`,
    [job.memory_id, job.user_id, job.generation, `${diagnostic.status ?? "unknown"}:${diagnostic.reason}`, retryDelay(job.attempts), token]);
    logger.warn(diagnostic, "Connection discovery retained for durable retry");
  }
  return true;
}
let workerStarted = false;
export function startConnectionWorker() {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    try { await scheduleWeeklyDiscovery(); }
    catch (error) { logger.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Weekly scheduler unavailable; discovery processing continues"); }
    try { await processConnectionJob(); }
    catch (error) { logger.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Connection worker unavailable; retrying"); }
    setTimeout(tick, 8000).unref();
  };
  void tick();
}