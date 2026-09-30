import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

test("disposable DB: one-hop scope, canonical transfer, shared uploads, durable schedule and ready-version queue", {
  skip: process.env.CONNECTIONS_DB_TEST !== "1" ? "Opt in after startup migration with CONNECTIONS_DB_TEST=1" : undefined,
}, async () => {
  const { pool } = await import("@workspace/db");
  const { confirmedOneHop, manualConnection, mergeConnection, changeConnection } = await import("./connections");
  const { queueDiscovery, scheduleWeeklyDiscovery } = await import("./connections-discovery");
  const { reserveAiBudget } = await import("./ai-budget");
  const owner = randomUUID(), outsider = randomUUID();
  try {
    for (const id of [owner, outsider]) await pool.query(`INSERT INTO users(id,email,password_hash,name)
      VALUES($1,$2,'not-a-login-credential','Disposable DB test')`, [id, `dots-db-${id}@example.test`]);
    const ids: number[] = [];
    for (const title of ["Selected content", "Loser content", "One-hop", "Two-hop", "Suggestion only", "Dismissal target"]) {
      ids.push((await pool.query("INSERT INTO memories(user_id,title,raw_text,type,status) VALUES($1,$2,$2,'note','confirmed') RETURNING id", [owner, title])).rows[0].id);
    }
    const other = (await pool.query("INSERT INTO memories(user_id,title) VALUES($1,'Other account secret') RETURNING id", [outsider])).rows[0].id;
    const [keep, loser, one, two, suggested, dismissed] = ids;
    const duplicate = await manualConnection(owner, keep, loser, "duplicate", "Test explicit duplicate");
    assert.ok(duplicate);
    await manualConnection(owner, loser, one, "follow_up", "Confirmed user follow-up");
    await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,reason,confidence)
      VALUES($1,$2,$3,'ai','suggested','same_topic','Stale AI suggestion',74)`, [owner, keep, one]);
    await manualConnection(owner, one, two);
    await pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,confidence)
      VALUES($1,$2,$3,'ai','suggested','same_topic',80)`, [owner, Math.min(keep, suggested), Math.max(keep, suggested)]);
    const terminal = await manualConnection(owner, keep, dismissed, "other", "Terminal user dismissal reason");
    await changeConnection(owner, terminal.id, "dismissed");
    await manualConnection(owner, loser, dismissed);
    await assert.rejects(manualConnection(owner, keep, other), /Memory not found/);
    const before = await confirmedOneHop(owner, [keep]);
    assert.deepEqual(before.map((row) => row.id), [loser], "no suggested/dismissed or multi-hop inclusion");
    const sharedPath = `/objects/uploads/${owner}/test-shared-not-stored`;
    await pool.query(`INSERT INTO uploads(path,user_id,name,size,content_type) VALUES($1,$2,'Fixture upload metadata',0,'text/plain')`, [sharedPath, owner]);
    await pool.query("UPDATE memories SET file_path=$1 WHERE user_id=$2 AND id=ANY($3::int[])", [sharedPath, owner, [keep, loser, one]]);
    const result = await mergeConnection(owner, duplicate.id, keep);
    assert.equal(result.id, keep); assert.equal(result.title, "Selected content"); assert.equal(result.raw_text, "Selected content");
    assert.equal((await pool.query("SELECT id FROM memories WHERE user_id=$1 AND id=$2", [owner, loser])).rowCount, 0);
    assert.equal((await pool.query("SELECT path FROM uploads WHERE user_id=$1 AND path=$2", [owner, sharedPath])).rowCount, 1);
    const hop = await confirmedOneHop(owner, [keep]);
    assert.deepEqual(hop.map((row) => row.id), [one]);
    assert.deepEqual(await confirmedOneHop(outsider, [keep]), []);
    const target = (await pool.query(`SELECT status FROM memory_links WHERE user_id=$1 AND memory_a_id=$2 AND memory_b_id=$3`, [owner, keep, dismissed])).rows[0];
    assert.equal(target.status, "dismissed", "merge deduplication never restores dismissed pair");
    const upgraded = (await pool.query(`SELECT status,source,relation_type,reason,confidence FROM memory_links
      WHERE user_id=$1 AND memory_a_id=$2 AND memory_b_id=$3`, [owner, keep, one])).rows[0];
    assert.deepEqual(upgraded, { status: "confirmed", source: "manual", relation_type: "follow_up",
      reason: "Confirmed user follow-up", confidence: 100 }, "confirmed payload replaces stale suggested metadata");
    assert.equal((await pool.query(`SELECT reason FROM memory_links WHERE user_id=$1
      AND memory_a_id=$2 AND memory_b_id=$3`, [owner, keep, dismissed])).rows[0].reason, "Terminal user dismissal reason");
    const tieIds: number[] = [];
    for (const title of ["Tie keep", "Tie loser", "Tie other"]) {
      tieIds.push((await pool.query("INSERT INTO memories(user_id,title) VALUES($1,$2) RETURNING id", [owner, title])).rows[0].id);
    }
    const tieDuplicate = await manualConnection(owner, tieIds[0], tieIds[1], "duplicate");
    const tieExisting = await manualConnection(owner, tieIds[0], tieIds[2]);
    await pool.query("UPDATE memory_links SET source='ai',reason='AI confirmed payload',confidence=90 WHERE id=$1 AND user_id=$2", [tieExisting.id, owner]);
    await manualConnection(owner, tieIds[1], tieIds[2], "same_person", "User confirmed payload");
    await mergeConnection(owner, tieDuplicate.id, tieIds[0]);
    assert.deepEqual((await pool.query("SELECT source,status,relation_type,reason,confidence FROM memory_links WHERE id=$1 AND user_id=$2",
      [tieExisting.id, owner])).rows[0], { source: "manual", status: "confirmed", relation_type: "same_person", reason: "User confirmed payload", confidence: 100 },
    "manual payload wins equal confirmed status while retaining target connection identity");
    // An explicit scan while indexing is pending survives auto-off and preserves
    // its explicit intent when the matching ready embedding version arrives.
    await pool.query("INSERT INTO connection_settings(user_id,automatic) VALUES($1,false)", [owner]);
    await queueDiscovery(owner, true);
    const job = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE user_id=$1 AND memory_id=$2", [owner, keep])).rows[0];
    assert.equal(job.explicit, true);
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [keep]);
    const ready = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE user_id=$1 AND memory_id=$2", [owner, keep])).rows[0];
    assert.equal(ready.explicit, true);
    await pool.query("UPDATE memories SET title='Edited chosen content' WHERE id=$1 AND user_id=$2", [keep, owner]);
    const version = (await pool.query("SELECT version,indexed_version FROM memory_embedding_jobs WHERE memory_id=$1", [keep])).rows[0];
    assert.notEqual(version.version, version.indexed_version);
    assert.equal((await pool.query("SELECT version FROM connection_discovery_jobs WHERE memory_id=$1 AND user_id=$2", [keep, owner])).rows[0].version, ready.version,
      "edit does not enqueue unready version");
    await pool.query("UPDATE memory_embedding_jobs SET indexed_version=version WHERE memory_id=$1", [keep]);
    const next = (await pool.query("SELECT * FROM connection_discovery_jobs WHERE memory_id=$1 AND user_id=$2", [keep, owner])).rows[0];
    assert.equal(next.version, ready.version);
    assert.equal(next.explicit, false); assert.equal(next.completed, true);
    assert.ok(Number(next.generation) > Number(ready.generation), "edit fences prior explicit generation without auto-off requeue");
    // Concurrent interactive requests serialize a durable per-account budget.
    // This never touches the global worker counter used by concurrent fixtures.
    const reservations = await Promise.all(Array.from({ length: 40 }, () => reserveAiBudget(owner)));
    assert.equal(reservations.filter(Boolean).length, 30);
    assert.equal(await reserveAiBudget(owner), false);
    await assert.rejects(pool.query(`UPDATE memory_links SET status='suggested'
      WHERE user_id=$1 AND memory_a_id=$2 AND memory_b_id=$3`, [owner, keep, dismissed]), /terminal/);
    // Fault injection is scheduling-only, never a fake AI response. Restrict
    // selection to these exact fixture owners so concurrent fixtures are untouched.
    await pool.query(`INSERT INTO connection_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING`, [outsider]);
    await pool.query(`UPDATE connection_settings SET automatic=true,next_weekly_at=now()-interval '1 day',
      scheduler_retry_at=now(),scheduler_attempts=0 WHERE user_id=ANY($1::varchar[])`, [[owner, outsider]]);
    const dueBefore = (await pool.query("SELECT next_weekly_at FROM connection_settings WHERE user_id=$1", [owner])).rows[0].next_weekly_at;
    await scheduleWeeklyDiscovery({ userIds: [owner, outsider], enqueue: async (id, explicit, client) => {
      if (id === owner) throw new Error("Synthetic scheduler-only transient failure");
      await queueDiscovery(id, explicit, client);
    } });
    const failed = (await pool.query("SELECT * FROM connection_settings WHERE user_id=$1", [owner])).rows[0];
    assert.equal(failed.scheduler_attempts, 1);
    assert.deepEqual(failed.next_weekly_at, dueBefore, "failed scheduling must not skip the missed week");
    assert.ok(failed.scheduler_retry_at.getTime() > Date.now());
    assert.equal(failed.scheduler_lease_token, null);
    assert.ok((await pool.query("SELECT next_weekly_at>now()+interval '6 days' AS advanced FROM connection_settings WHERE user_id=$1", [outsider])).rows[0].advanced,
      "another due user still schedules after the first user's failure");
    await pool.query("UPDATE connection_settings SET scheduler_retry_at=now() WHERE user_id=$1", [owner]);
    await scheduleWeeklyDiscovery({ userIds: [owner] });
    const recovered = (await pool.query("SELECT * FROM connection_settings WHERE user_id=$1", [owner])).rows[0];
    assert.equal(recovered.scheduler_attempts, 0); assert.equal(recovered.last_scheduler_error, null);
    assert.ok(recovered.next_weekly_at.getTime() > Date.now() + 6 * 24 * 3600 * 1000);
  } finally {
    await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [[owner, outsider]]);
    await pool.query("DELETE FROM ai_usage_limits WHERE scope=ANY($1::text[])", [[`interactive:${owner}`, `interactive:${outsider}`]]);
    await pool.end();
  }
});