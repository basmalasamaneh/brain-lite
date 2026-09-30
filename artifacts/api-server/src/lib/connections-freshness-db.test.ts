import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test("pending AI reasons invalidate on either endpoint; explicit discovery is version-bound and one-time", {
  skip: process.env.CONNECTIONS_DB_TEST !== "1" ? "Opt in with CONNECTIONS_DB_TEST=1" : undefined,
}, async () => {
  const { pool } = await import("@workspace/db");
  const { initializeConnections, connectionRows, changeConnection, mergeConnection, ownerTransaction } = await import("./connections");
  const { queueDiscovery, processConnectionJob } = await import("./connections-discovery");
  const owner = randomUUID();
  try {
    // Use the actual additive startup runner, including its advisory lock.
    await initializeConnections();
    await pool.query(`INSERT INTO users(id,email,password_hash,name)
      VALUES($1,$2,'not-a-login-credential','Disposable freshness regression')`, [owner, `freshness-${owner}@example.test`]);
    await pool.query("INSERT INTO connection_settings(user_id,automatic,next_weekly_at) VALUES($1,false,now()+interval '7 days')", [owner]);
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push((await pool.query(
      "INSERT INTO memories(user_id,title,raw_text) VALUES($1,$2,$2) RETURNING id", [owner, `Disposable ${i}`])).rows[0].id);
    const [a, b, c, d, e, f, isolated] = ids;
    const insertLink = async (left: number, right: number, status = "suggested", source = "ai") =>
      (await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
        VALUES($1,$2,$3,$4,$5,'duplicate','Old version reason',85) RETURNING id`,
      [owner, Math.min(left, right), Math.max(left, right), source, status])).rows[0].id as number;
    const pending = await insertLink(a, b);
    const confirmedAi = await insertLink(a, c, "confirmed");
    const confirmedManual = await insertLink(a, d, "confirmed", "manual");
    const dismissed = await insertLink(a, e, "dismissed");
    const unrelated = await insertLink(e, f);
    await queueDiscovery(owner, true);
    const old = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [a])).rows[0];
    await pool.query("UPDATE connection_discovery_jobs SET lease_token='old-worker',lease_until=now()+interval '1 minute' WHERE memory_id=$1", [a]);
    // Candidate edit, not source edit, invalidates the pair in the same transaction.
    await ownerTransaction(owner, (tx) => tx.query("UPDATE memories SET raw_text='Changed candidate' WHERE id=$1 AND user_id=$2", [b, owner]));
    assert.deepEqual(await connectionRows(owner, { id: pending }), []);
    await assert.rejects(changeConnection(owner, pending, "confirmed"), /Connection not found/);
    await assert.rejects(mergeConnection(owner, pending, a), /Connection not found/);
    assert.equal((await pool.query("SELECT id FROM memories WHERE user_id=$1", [owner])).rowCount, 7, "stale merge deletes nothing");
    const sourcePending = await insertLink(a, b);
    await ownerTransaction(owner, (tx) => tx.query("UPDATE memories SET summary='Changed source' WHERE id=$1 AND user_id=$2", [a, owner]));
    assert.deepEqual(await connectionRows(owner, { id: sourcePending }), []);
    const retained = (await pool.query("SELECT id FROM memory_links WHERE user_id=$1 ORDER BY id", [owner])).rows.map((r) => r.id);
    assert.deepEqual(retained, [confirmedAi, confirmedManual, dismissed, unrelated]);
    await assert.rejects(changeConnection(owner, dismissed, "confirmed"), /cannot be restored/);
    const cancelled = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [a])).rows[0];
    assert.equal(cancelled.explicit, false); assert.equal(cancelled.completed, true);
    assert.equal(cancelled.lease_token, null);
    assert.ok(BigInt(cancelled.generation) > BigInt(old.generation));
    const staleFence = await pool.query(`UPDATE connection_discovery_jobs SET completed=false
      WHERE memory_id=$1 AND generation=$2 AND version=$3 AND lease_token='old-worker'`, [a, old.generation, old.version]);
    assert.equal(staleFence.rowCount, 0, "in-flight generation cannot revive after edit");
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=ANY($1::int[])", [[a, b]]);
    assert.equal((await pool.query("SELECT completed FROM connection_discovery_jobs WHERE memory_id=$1", [a])).rows[0].completed, true,
      "auto-off readiness does not requeue cancelled explicit discovery");
    await queueDiscovery(owner, false);
    assert.equal((await pool.query("SELECT generation FROM connection_discovery_jobs WHERE memory_id=$1", [a])).rows[0].generation, cancelled.generation);

    // A fresh request while indexing is pending survives readiness at EXACTLY
    // that version. The actual no-candidate worker path never calls Gemini.
    await queueDiscovery(owner, true);
    const requested = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [isolated])).rows[0];
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [isolated]);
    const ready = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [isolated])).rows[0];
    assert.equal(ready.explicit, true); assert.equal(ready.generation, requested.generation);
    const vector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0);
    const vectorType = (await pool.query(`SELECT udt_name FROM information_schema.columns
      WHERE table_name='memories' AND column_name='embedding'`)).rows[0].udt_name;
    await pool.query(`UPDATE memories SET embedding=$1${vectorType === "vector" ? "::vector" : "::double precision[]"} WHERE id=$2`,
      [vectorType === "vector" ? JSON.stringify(vector) : vector, isolated]);
    await pool.query("UPDATE connection_discovery_jobs SET next_attempt_at=now() WHERE memory_id=$1", [isolated]);
    assert.equal(await processConnectionJob({ memoryIds: [isolated] }), true);
    const completed = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [isolated])).rows[0];
    assert.equal(completed.completed, true); assert.equal(completed.explicit, false); assert.equal(completed.last_error, null);
    assert.equal(await processConnectionJob({ memoryIds: [isolated] }), false);
    await pool.query("UPDATE memories SET tags=ARRAY['new tag'] WHERE id=$1", [isolated]);
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [isolated]);
    assert.equal(await processConnectionJob({ memoryIds: [isolated] }), false, "completion cannot authorize future edited versions");

    // New auto-off memory readiness creates no automatic job.
    const quiet = (await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Quiet new memory') RETURNING id", [owner])).rows[0].id;
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [quiet]);
    assert.equal((await pool.query("SELECT memory_id FROM connection_discovery_jobs WHERE memory_id=$1", [quiet])).rowCount, 0);
    await pool.query("UPDATE connection_settings SET automatic=true WHERE user_id=$1", [owner]);
    await pool.query("UPDATE memories SET people=ARRAY['Updated person'] WHERE id=$1", [a]);
    const currentVersion = (await pool.query("SELECT version FROM memory_embedding_jobs WHERE memory_id=$1", [a])).rows[0].version;
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [a]);
    const automatic = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1", [a])).rows[0];
    assert.equal(automatic.version, currentVersion); assert.equal(automatic.explicit, false); assert.equal(automatic.completed, false);
    assert.equal((await connectionRows(owner, { id: confirmedAi }))[0].status, "confirmed");
    assert.equal((await connectionRows(owner, { id: dismissed }))[0].status, "dismissed");
    // Force the old initial-read/new-content race with a direct DB writer (which
    // does not take the HTTP owner lock). Actions must lock memories, then reread
    // the link after the edit's invalidation commits.
    for (const action of ["confirm", "merge"] as const) {
      const racing = await insertLink(a, b);
      const editor = await pool.connect();
      let result: Promise<unknown> | undefined;
      try {
        await editor.query("BEGIN");
        const pid = (await editor.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await editor.query("UPDATE memories SET title=$1 WHERE id=$2 AND user_id=$3", [`Racing ${action} edit`, b, owner]);
        result = (action === "confirm" ? changeConnection(owner, racing, "confirmed") : mergeConnection(owner, racing, a))
          .then(() => new Error("Unexpected stale action success"), (error: unknown) => error);
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          blocked = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE $1::int=ANY(pg_blocking_pids(pid))) AS blocked`, [pid])).rows[0].blocked;
          if (blocked) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, true, `${action} reached the memory lock with a pre-edit link snapshot`);
        await editor.query("COMMIT");
        const error = await result;
        assert.ok(error instanceof Error);
        assert.match(error.message, /Connection not found/);
        assert.equal((await pool.query("SELECT id FROM memories WHERE id=ANY($1::int[]) AND user_id=$2", [[a, b], owner])).rowCount, 2);
      } finally {
        await editor.query("ROLLBACK");
        editor.release();
        if (result) await result;
      }
    }
    // Re-running the normal runner must retain data and the final trigger.
    const { readFile } = await import("node:fs/promises");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(768001)");
      await client.query(await readFile(new URL("../../../../lib/db/migrations/0007_connection_freshness.sql", import.meta.url), "utf8"));
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    assert.equal((await pool.query("SELECT id FROM memory_links WHERE user_id=$1", [owner])).rowCount, 4);
  } finally {
    await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    await pool.end();
  }
});