import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db, pool, memoriesTable, usersTable, spaceMemoriesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { initializeSemanticSearch, retrieveForQuestion } from "./semantic-search";
import { initializeConnections, confirmedOneHop } from "./connections";
import { initializeSpaces, createSpace, requireSpace, confirmCaptured, refreshCreationSuggestions } from "./spaces";
import { normalizeSpaceName } from "./spaces-utils";
import { SPACE_SUGGESTION_INSERT } from "./spaces-discovery";

test("additive idempotent migration, composite ownership, terminal dismissals, scoped totals and safe cascades", {
  skip: process.env.SPACES_DB_TEST !== "1" ? "Opt in with SPACES_DB_TEST=1 (only disposable fixtures are deleted)" : undefined,
}, async () => {
  await initializeSemanticSearch(); await initializeConnections(); await initializeSpaces();
  const migration = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../../../../lib/db/migrations/0005_spaces.sql", import.meta.url), "utf8"));
  const a = randomUUID(); const b = randomUUID();
  await db.insert(usersTable).values([a, b].map((id) => ({ id, email: `spaces-db-${id}@example.com`, name: "Spaces isolated test", passwordHash: "unused-fixture-password-hash" })));
  try {
    // Reapply packaged SQL inside a transaction without changing existing data.
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(768001)"); await client.query(migration); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    const space = await createSpace(a, { kind: "project", name: "Fixture Project" });
    const snapshot = (await pool.query("SELECT updated_at::text AS updated_version FROM spaces WHERE user_id=$1 AND id=$2", [a, space])).rows[0];
    assert.equal((await pool.query("SELECT id FROM spaces WHERE user_id=$1 AND id=$2 AND updated_at=$3::timestamptz", [a, space, snapshot.updated_version])).rowCount, 1, "Exact SQL timestamp fence preserves microseconds");
    const [inside, outside, foreign] = await db.insert(memoriesTable).values([
      { userId: a, title: "Fixture lunch receipt", raw_text: "Lunch cost 12 USD", type: "receipt" as const, amount: 12, currency: "USD" },
      { userId: a, title: "Unrelated receipt", raw_text: "Unrelated furniture 900 USD", type: "receipt" as const, amount: 900, currency: "USD" },
      { userId: b, title: "Foreign receipt", raw_text: "Other owner's receipt", type: "receipt" as const, amount: 8000, currency: "USD" },
    ]).returning();
    assert.ok((await pool.query(`EXPLAIN ${SPACE_SUGGESTION_INSERT}`, [a, space, inside.id, "Planning-only fixture", 85, snapshot.updated_version])).rows.length, "AI insertion has consistent typed parameters; EXPLAIN never inserts a fake AI result");
    await assert.rejects(requireSpace(b, space), /Space not found/);
    await assert.rejects(pool.query("INSERT INTO space_memories(user_id,space_id,memory_id,source,status) VALUES($1,$2,$3,'manual','confirmed')", [a, space, foreign.id]), (e: unknown) => (e as { code: string }).code === "23503");
    await db.transaction(async (tx) => { await confirmCaptured(tx, a, space, [inside.id]); });
    await db.transaction(async (tx) => { await confirmCaptured(tx, a, space, [inside.id, inside.id]); });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM space_memories WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, inside.id])).rows[0].count, 1, "Explicit confirmation is idempotent");
    await pool.query("INSERT INTO space_memories(user_id,space_id,memory_id,source,status,reason,confidence) VALUES($1,$2,$3,'ai','suggested','Explicitly selected candidate',88)", [a, space, outside.id]);
    await db.transaction(async (tx) => { await confirmCaptured(tx, a, space, [outside.id]); });
    assert.equal((await pool.query("SELECT status FROM space_memories WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, outside.id])).rows[0].status, "confirmed", "Explicit helper upgrades suggested membership");
    await pool.query("DELETE FROM space_memories WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, outside.id]);
    const scope = await retrieveForQuestion(a, "What is my total spending?", "UTC", space);
    const aggregate = scope.aggregate as { groups: { total_amount: number }[] };
    assert.equal(aggregate.groups[0].total_amount, 12);
    assert.ok(scope.related.every((r) => r.memory.id === inside.id));
    const [left, right] = [inside.id, outside.id].sort((x, y) => x - y);
    await pool.query("INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence) VALUES($1,$2,$3,'manual','confirmed','other','explicit fixture relation',100)", [a, left, right]);
    assert.deepEqual((await confirmedOneHop(a, [inside.id])).map((m) => m.id), [outside.id]);
    assert.deepEqual(await confirmedOneHop(b, [inside.id]), []);
    await pool.query("UPDATE space_memories SET status='dismissed' WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, inside.id]);
    await assert.rejects(db.transaction(async (tx) => { await confirmCaptured(tx, a, space, [inside.id]); }), /Dismissed Space memberships cannot be restored/);
    await assert.rejects(pool.query("UPDATE space_memories SET status='suggested' WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, inside.id]), (e: unknown) => (e as { code: string }).code === "23514");
    const second = await createSpace(a, { kind: "topic", name: "Another fixture Space" });
    assert.ok((await pool.query("SELECT 1 FROM space_matching_jobs WHERE user_id=$1 AND memory_id=$2 AND NOT completed", [a, inside.id])).rowCount, "New Space queues existing memories");
    await db.transaction(async (tx) => { await confirmCaptured(tx, a, second, [inside.id]); });
    assert.equal((await db.select().from(spaceMemoriesTable).where(and(eq(spaceMemoriesTable.userId, a), eq(spaceMemoriesTable.memory_id, inside.id)))).length, 2);
    await pool.query("UPDATE memory_embedding_jobs SET version=version+1 WHERE memory_id=$1", [inside.id]);
    assert.ok((await pool.query(`SELECT 1 FROM space_matching_jobs d JOIN memory_embedding_jobs j ON j.memory_id=d.memory_id
      WHERE d.user_id=$1 AND d.memory_id=$2 AND d.version=j.version AND NOT d.completed`, [a, inside.id])).rowCount, "Reindex keeps matching job version current");
    await pool.query("INSERT INTO space_memories(user_id,space_id,memory_id,source,status,reason,confidence) VALUES($1,$2,$3,'ai','suggested','Prior content',85)", [a, second, outside.id]);
    await pool.query("UPDATE memories SET tags=ARRAY['Edited unrelated content'] WHERE user_id=$1 AND id=$2", [a, outside.id]);
    assert.equal((await pool.query("SELECT 1 FROM space_memories WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, second, outside.id])).rowCount, 0, "Edits invalidate only old pending AI suggestions");
    assert.equal((await pool.query("SELECT status FROM space_memories WHERE user_id=$1 AND space_id=$2 AND memory_id=$3", [a, space, inside.id])).rows[0].status, "dismissed");
    const before = Number((await pool.query("SELECT count(*) FROM memories WHERE user_id=$1", [a])).rows[0].count);
    await assert.rejects(db.transaction(async (tx) => {
      const [newMemory] = await tx.insert(memoriesTable).values({ userId: a, title: "Must roll back", raw_text: "Must roll back" }).returning();
      await confirmCaptured(tx, a, randomUUID(), [newMemory.id]);
    }), /Space not found/);
    assert.equal(Number((await pool.query("SELECT count(*) FROM memories WHERE user_id=$1", [a])).rows[0].count), before);
    await db.insert(memoriesTable).values([1, 2, 3].map((n) => ({ userId: a, title: `Sara encounter ${n}`, raw_text: `Discussed plans with Sara ${n}`, people: ["Sara"], tags: ["Shared topic"] })));
    await refreshCreationSuggestions(a);
    const suggestions = (await pool.query("SELECT * FROM space_creation_suggestions WHERE user_id=$1", [a])).rows;
    assert.ok(suggestions.some((s) => s.name === "Sara" && s.kind === "person"));
    assert.ok(suggestions.some((s) => s.name === "Shared topic"));
    assert.equal(Number((await pool.query("SELECT count(*) FROM spaces WHERE user_id=$1", [a])).rows[0].count), 2);
    const sara = suggestions.find((s) => s.name === "Sara");
    await pool.query("UPDATE space_creation_suggestions SET status='dismissed' WHERE id=$1 AND user_id=$2", [sara.id, a]);
    await refreshCreationSuggestions(a);
    assert.equal((await pool.query("SELECT status FROM space_creation_suggestions WHERE user_id=$1 AND normalized_name=$2", [a, normalizeSpaceName("Sara")])).rows[0].status, "dismissed");
    await pool.query("DELETE FROM spaces WHERE user_id=$1 AND id=$2", [a, second]);
    assert.ok((await pool.query("SELECT id FROM memories WHERE user_id=$1 AND id=$2", [a, inside.id])).rowCount);
    await pool.query("DELETE FROM memories WHERE user_id=$1 AND id=$2", [a, inside.id]);
    assert.equal((await pool.query("SELECT 1 FROM space_memories WHERE user_id=$1 AND memory_id=$2", [a, inside.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM space_matching_jobs WHERE user_id=$1 AND memory_id=$2", [a, inside.id])).rowCount, 0);
  } finally {
    // Only accounts created by this test are removed; no existing user's data.
    await db.delete(usersTable).where(eq(usersTable.id, a)); await db.delete(usersTable).where(eq(usersTable.id, b));
  }
  assert.equal((await pool.query("SELECT 1 FROM spaces WHERE user_id=ANY($1::varchar[])", [[a, b]])).rowCount, 0);
});