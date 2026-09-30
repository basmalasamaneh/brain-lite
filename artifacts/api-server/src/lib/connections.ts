import { readFile } from "node:fs/promises";
import { db, pool, memoriesTable, memoryLinksTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { publicMemory } from "./semantic-search";
import { canonicalPair, mergedStatus, preferredConnectionPayload } from "./connections-utils";
import type { PoolClient } from "pg";

let initialization: Promise<void> | undefined;
export function initializeConnections(): Promise<void> {
  if (!initialization) initialization = (async () => {
    let migration: string | undefined;
    for (const path of [new URL("./connections-migration.sql", import.meta.url), new URL("../../../../lib/db/migrations/0004_connections.sql", import.meta.url)]) {
      try { migration = await readFile(path, "utf8"); break; } catch { /* bundled/source layout */ }
    }
    if (!migration) throw new Error("CONNECTIONS_MIGRATION_MISSING");
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
export class ConnectionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function ownerTransaction<T>(userId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,768004))", [userId]);
    const owner = await client.query("SELECT id FROM users WHERE id=$1 FOR KEY SHARE", [userId]);
    if (!owner.rowCount) throw new ConnectionError(404, "Account not found");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function connectionRows(userId: string, filter: { memoryId?: number; id?: number; suggestions?: boolean } = {}) {
  const links = await db.select().from(memoryLinksTable).where(and(
    eq(memoryLinksTable.userId, userId),
    filter.id !== undefined ? eq(memoryLinksTable.id, filter.id) : undefined,
    filter.suggestions ? eq(memoryLinksTable.status, "suggested") : undefined,
  ));
  const selected = links.filter((link) => filter.memoryId === undefined || link.memory_a_id === filter.memoryId || link.memory_b_id === filter.memoryId);
  const ids = [...new Set(selected.flatMap((link) => [link.memory_a_id, link.memory_b_id]))];
  const memories = ids.length ? await db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), inArray(memoriesTable.id, ids))) : [];
  const byId = new Map(memories.map((m) => [m.id, publicMemory(m)]));
  return selected.filter((link) => byId.has(link.memory_a_id) && byId.has(link.memory_b_id)).map(({ userId: _owner, memory_a_id, memory_b_id, ...link }) => ({
    ...link, memory_a: byId.get(memory_a_id)!, memory_b: byId.get(memory_b_id)!,
    created_at: link.created_at.toISOString(), updated_at: link.updated_at.toISOString(),
  })).sort((a, b) => b.confidence - a.confidence || b.id - a.id);
}
export async function requireMemory(userId: string, id: number) {
  const [memory] = await db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), eq(memoriesTable.id, id)));
  if (!memory) throw new ConnectionError(404, "Memory not found");
  return memory;
}
export async function connectionSettings(userId: string) {
  const result = await pool.query(`SELECT coalesce((SELECT automatic FROM connection_settings WHERE user_id=$1),true) AS automatic,
    (SELECT count(*)::int FROM memory_links WHERE user_id=$1 AND status='confirmed') AS confirmed_count`, [userId]);
  return result.rows[0];
}
export async function manualConnection(userId: string, id: number, other: number, relation = "other", reason = "") {
  const [a, b] = canonicalPair(id, other);
  const linkId = await ownerTransaction(userId, async (client) => {
    const owned = await client.query("SELECT id FROM memories WHERE user_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE", [userId, [a, b]]);
    if (owned.rowCount !== 2) throw new ConnectionError(404, "Memory not found");
    const existing = await client.query("SELECT id,status FROM memory_links WHERE user_id=$1 AND memory_a_id=$2 AND memory_b_id=$3 FOR UPDATE", [userId, a, b]);
    if (existing.rows[0]?.status === "dismissed") throw new ConnectionError(409, "This pair was dismissed and cannot be recreated");
    const result = await client.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      VALUES($1,$2,$3,'manual','confirmed',$4,$5,100)
      ON CONFLICT(user_id,memory_a_id,memory_b_id) DO UPDATE SET status='confirmed',source='manual',
        relation_type=EXCLUDED.relation_type,reason=EXCLUDED.reason,confidence=100,updated_at=now() RETURNING id`, [userId, a, b, relation, reason]);
    return result.rows[0].id as number;
  });
  return (await connectionRows(userId, { id: linkId }))[0];
}
export async function changeConnection(userId: string, id: number, status: "confirmed" | "dismissed") {
  await ownerTransaction(userId, async (client) => {
    const result = await client.query("SELECT status FROM memory_links WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId]);
    if (!result.rowCount) throw new ConnectionError(404, "Connection not found");
    if (result.rows[0].status === "dismissed" && status !== "dismissed") throw new ConnectionError(409, "Dismissed connections cannot be restored");
    await client.query("UPDATE memory_links SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2", [id, userId, status]);
  });
  return (await connectionRows(userId, { id }))[0];
}
export async function mergeConnection(userId: string, id: number, keepId: number) {
  await ownerTransaction(userId, async (client) => {
    const initial = await client.query("SELECT * FROM memory_links WHERE id=$1 AND user_id=$2", [id, userId]);
    const link = initial.rows[0];
    if (!link) throw new ConnectionError(404, "Connection not found");
    if (link.relation_type !== "duplicate" || link.status === "dismissed") throw new ConnectionError(409, "Only active duplicate connections can be merged");
    if (![link.memory_a_id, link.memory_b_id].includes(keepId)) throw new ConnectionError(400, "Choose one of the duplicate memories to keep");
    const loser = link.memory_a_id === keepId ? link.memory_b_id : link.memory_a_id;
    // Lock memories first, matching indexing/edit lock order; no content fields are overwritten.
    const locked = await client.query("SELECT id FROM memories WHERE user_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE", [userId, [keepId, loser]]);
    if (locked.rowCount !== 2) throw new ConnectionError(404, "Memory not found");
    const links = await client.query("SELECT * FROM memory_links WHERE user_id=$1 AND (memory_a_id=$2 OR memory_b_id=$2) ORDER BY id FOR UPDATE", [userId, loser]);
    for (const moved of links.rows) {
      const other = moved.memory_a_id === loser ? moved.memory_b_id : moved.memory_a_id;
      if (other === keepId) continue;
      const [a, b] = canonicalPair(keepId, other);
      const existing = (await client.query(`SELECT * FROM memory_links
        WHERE user_id=$1 AND memory_a_id=$2 AND memory_b_id=$3 FOR UPDATE`, [userId, a, b])).rows[0];
      const payload = existing ? preferredConnectionPayload(existing, moved) : moved;
      const status = existing ? mergedStatus(existing.status, moved.status) : moved.status;
      await client.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,memory_a_id,memory_b_id)
        DO UPDATE SET status=EXCLUDED.status,source=EXCLUDED.source,
          relation_type=EXCLUDED.relation_type,reason=EXCLUDED.reason,confidence=EXCLUDED.confidence,
          updated_at=now()`, [userId, a, b, payload.source, status, payload.relation_type, payload.reason, payload.confidence, payload.created_at]);
    }
    await client.query("DELETE FROM memories WHERE id=$1 AND user_id=$2", [loser, userId]);
    // Upload ownership records/files intentionally remain: multi-item captures
    // can share the file with the kept memory or other owned memories. Existing
    // account-data cleanup is the safe authoritative place to delete uploads.
  });
  return publicMemory(await requireMemory(userId, keepId));
}

/** Expand only original retrieval IDs, never recursively. Structured SQL scope
 * stays unchanged: extra context does not participate in aggregate arithmetic. */
export async function confirmedOneHop(userId: string, ids: number[]) {
  if (!ids.length) return [];
  const result = await pool.query(`SELECT DISTINCT CASE WHEN memory_a_id=ANY($2::int[]) THEN memory_b_id ELSE memory_a_id END AS id
    FROM memory_links WHERE user_id=$1 AND status='confirmed'
      AND (memory_a_id=ANY($2::int[]) OR memory_b_id=ANY($2::int[]))`, [userId, ids]);
  const added = result.rows.map((row) => row.id as number).filter((id) => !ids.includes(id));
  return added.length ? db.select().from(memoriesTable).where(and(eq(memoriesTable.userId, userId), inArray(memoriesTable.id, added))) : [];
}