import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, spacesTable, spaceMemoriesTable, memoriesTable } from "@workspace/db";
import { ConnectionError, ownerTransaction } from "./connections";
import { defaultIcons, normalizeSpaceName, type spaceBody } from "./spaces-utils";
import type { z } from "zod";
import type { PoolClient } from "pg";

let initialization: Promise<void> | undefined;
export function initializeSpaces(): Promise<void> {
  if (!initialization) initialization = (async () => {
    let migration: string | undefined;
    for (const path of [new URL("./spaces-migration.sql", import.meta.url), new URL("../../../../lib/db/migrations/0005_spaces.sql", import.meta.url)]) {
      try { migration = await readFile(path, "utf8"); break; } catch { /* bundled/source layout */ }
    }
    if (!migration) throw new Error("SPACES_MIGRATION_MISSING");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(768001)");
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}
export function serializeSpace(row: typeof spacesTable.$inferSelect) {
  const { userId: _owner, ...space } = row;
  return { ...space, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() };
}
export async function requireSpace(userId: string, id: string) {
  const [space] = await db.select().from(spacesTable).where(and(eq(spacesTable.userId, userId), eq(spacesTable.id, id)));
  if (!space) throw new ConnectionError(404, "Space not found");
  return space;
}
type CaptureTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Ownership checked again inside the capture transaction. Deleting the space
 * during extraction rolls back ALL created memories rather than orphaning them.
 * This helper represents explicit user confirmation of the selected Space:
 * repeat confirmations are idempotent, suggestions upgrade, dismissals never do. */
export async function confirmCaptured(tx: CaptureTx, userId: string, spaceId: string | undefined, memoryIds: number[]) {
  if (!spaceId) return;
  const owned = await tx.select().from(spacesTable).where(and(eq(spacesTable.userId, userId), eq(spacesTable.id, spaceId))).for("key share");
  if (!owned.length) throw new ConnectionError(404, "Space not found");
  const ids = [...new Set(memoryIds)];
  if (!ids.length) return;
  const confirmed = await tx.insert(spaceMemoriesTable).values(ids.map((memory_id) => ({
    userId, space_id: spaceId, memory_id, status: "confirmed" as const, source: "manual" as const,
  }))).onConflictDoUpdate({
    target: [spaceMemoriesTable.space_id, spaceMemoriesTable.memory_id],
    set: { status: "confirmed", source: "manual", confidence: 100 },
    setWhere: and(eq(spaceMemoriesTable.userId, userId), sql`${spaceMemoriesTable.status}<>'dismissed'`),
  }).returning({ memory_id: spaceMemoriesTable.memory_id });
  if (confirmed.length !== ids.length) throw new ConnectionError(409, "Dismissed Space memberships cannot be restored");
}
export async function queueOwnedMemories(client: PoolClient, userId: string) {
  await client.query(`INSERT INTO space_matching_jobs(memory_id,user_id,version)
    SELECT m.id,m.user_id,j.version FROM memories m JOIN memory_embedding_jobs j ON j.memory_id=m.id
    WHERE m.user_id=$1 AND NOT m.is_sample
    ON CONFLICT(memory_id) DO UPDATE SET version=EXCLUDED.version,generation=space_matching_jobs.generation+1,
      completed=false,attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL`, [userId]);
}
export async function createSpace(userId: string, data: z.infer<typeof spaceBody>, client?: PoolClient) {
  const run = async (tx: PoolClient) => {
    const result = await tx.query(`INSERT INTO spaces(user_id,kind,name,description,icon,color,pinned,archived)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [userId, data.kind, data.name, data.description ?? null, data.icon ?? defaultIcons[data.kind], data.color ?? "gold", data.pinned ?? false, data.archived ?? false]);
    await queueOwnedMemories(tx, userId);
    return result.rows[0].id as string;
  };
  const id = client ? await run(client) : await ownerTransaction(userId, run);
  // Within a transaction its new row is not visible on another connection.
  return id;
}
export async function confirmedMembers(userId: string, spaceId: string) {
  return db.select({ memory: memoriesTable }).from(spaceMemoriesTable)
    .innerJoin(memoriesTable, and(eq(memoriesTable.id, spaceMemoriesTable.memory_id), eq(memoriesTable.userId, userId)))
    .where(and(eq(spaceMemoriesTable.userId, userId), eq(spaceMemoriesTable.space_id, spaceId), eq(spaceMemoriesTable.status, "confirmed")))
    .orderBy(sql`${memoriesTable.created_at} DESC`).then((rows) => rows.map((row) => row.memory));
}
/** Repeated entities are deterministic evidence, not fabricated AI data. Gemini
 * is reserved for membership judgment. Dismissal and confirmation persist. */
export async function refreshCreationSuggestions(userId: string) {
  const memories = await db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), eq(memoriesTable.is_sample, false)));
  const spaces = await db.select().from(spacesTable).where(eq(spacesTable.userId, userId));
  const candidates = new Map<string, { kind: "person" | "trip" | "project" | "topic"; name: string; ids: Set<number>; ar: boolean }>();
  for (const memory of memories) {
    for (const [name, person] of [...memory.people.map((p) => [p, true] as const), ...memory.tags.map((t) => [t, false] as const), [memory.title, false] as const]) {
      const key = normalizeSpaceName(name);
      if (key.length < 2 || name.length > 120 || /^(sample|note|task|document|receipt|ملاحظة|مهمة)$/.test(key)) continue;
      const kind = person ? "person" : /trip|travel|رحلة|سفر/i.test(name) ? "trip" : /project|مشروع/i.test(name) ? "project" : "topic";
      const candidate = candidates.get(key) ?? { kind, name: name.trim(), ids: new Set<number>(), ar: /[ء-ي]/.test(`${memory.title} ${memory.raw_text}`) };
      if (person) candidate.kind = "person";
      candidate.ids.add(memory.id); candidates.set(key, candidate);
    }
  }
  for (const [key, candidate] of candidates) {
    if (candidate.ids.size < 3 || spaces.some((space) => normalizeSpaceName(space.name) === key)) continue;
    const reason = candidate.ar ? `يتكرر «${candidate.name}» في ${candidate.ids.size} ذكريات.` : `"${candidate.name}" appears in ${candidate.ids.size} memories.`;
    await pool.query(`INSERT INTO space_creation_suggestions(user_id,kind,name,normalized_name,reason)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,normalized_name) DO UPDATE SET reason=EXCLUDED.reason
      WHERE space_creation_suggestions.status='suggested'`, [userId, candidate.kind, candidate.name, key, reason]);
  }
  return candidates;
}