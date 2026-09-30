// Run only against the already-running development API through the shared proxy:
// SEMANTIC_API_TEST=1 node --test artifacts/api-server/src/lib/semantic-integration.test.mjs
// Creates disposable accounts; cleanup is scoped exclusively to their IDs/emails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const dbRequire = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { Pool } = dbRequire("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const base = "http://localhost:80/api";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, cookie, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  let data;
  if (response.status !== 204) { try { data = await response.json(); } catch { data = undefined; } }
  return { response, data, status: response.status };
}
// The production API correctly surfaces transient capacity failures as 503.
// Exercise a real follow-up request, report every retry, and still fail on a
// persistent error instead of substituting a fake or ungrounded response.
async function ask(cookie, body, context) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await api("/brain/ask", cookie, "POST", body);
    if (result.status !== 503 || attempt === 3) return result;
    context.diagnostic(`Ask returned HTTP 503; real request retry ${attempt} after ${attempt * 4} seconds.`);
    await sleep(attempt * 4000);
  }
}
async function signup(suffix) {
  const nonce = randomUUID();
  const email = `semantic-${suffix}-${nonce}@example.test`.toLowerCase();
  const result = await api("/auth/signup", undefined, "POST", {
    email, password: `Disposable-${randomUUID()}-9a!`, name: `Semantic disposable ${suffix}`, language: "en", theme: "system",
  });
  assert.equal(result.status, 201, "Disposable signup must succeed");
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const row = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  return { id: row.rows[0].id, email, cookie };
}
function assertPrivateStripped(data) {
  const forbidden = /"(?:embedding|user_id|userId|indexed_version|lease_until|last_error|password_hash)"\s*:/;
  assert.equal(forbidden.test(JSON.stringify(data)), false);
}
async function waitIndexed(account, timeout = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await api("/indexing/status", account.cookie);
    assert.equal(result.status, 200);
    if (result.data.indexed === result.data.total) return result.data;
    if (result.data.failed) {
      const diagnostic = await pool.query(`SELECT j.last_error FROM memory_embedding_jobs j
        JOIN memories m ON m.id=j.memory_id WHERE m.user_id=$1 AND j.last_error IS NOT NULL LIMIT 1`, [account.id]);
      // Error is fixed safe status/reason only, never provider URLs or keys.
      throw new Error(`Live embedding blocked: ${diagnostic.rows[0]?.last_error ?? "unknown"}`);
    }
    await sleep(3000);
  }
  throw new Error("Live indexing did not complete within four minutes");
}

test("live semantic API: multilingual retrieval, >8-row totals, two-account isolation and lifecycle", {
  timeout: 720000,
  skip: process.env.SEMANTIC_API_TEST !== "1" ? "Opt in with SEMANTIC_API_TEST=1 against the running development API" : undefined,
}, async (t) => {
  const accounts = [];
  const baseline = (await pool.query("SELECT id,user_id FROM memories")).rows;
  const original = baseline.map((row) => row.id);
  const originalOwners = new Set(baseline.map((row) => row.user_id));
  try {
    const a = await signup("A"); accounts.push(a);
    const b = await signup("B"); accounts.push(b);
    assert.ok(accounts.every((account) => !originalOwners.has(account.id)), "Fixture accounts must never own baseline user memories");
    for (const account of accounts) assert.equal((await api("/memories/samples", account.cookie, "DELETE")).status, 204);
    const today = new Date().toISOString().slice(0, 10);
    const seed = async (user, title, type, text, fields = {}) => {
      const result = await pool.query(`INSERT INTO memories(user_id,title,type,summary,raw_text,event_date,amount,currency,people,tags,status,confidence)
        VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'confirmed',100) RETURNING id`,
      [user.id, title, type, text, fields.date ?? null, fields.amount ?? null, fields.currency ?? null, fields.people ?? [], fields.tags ?? []]);
      return result.rows[0].id;
    };
    const receiptIds = [];
    for (let i = 1; i <= 11; i++) receiptIds.push(await seed(a, `Disposable receipt ${i}`, "receipt", `Paid ${i * 10} USD for groceries.`, {
      amount: i * 10, currency: "USD", date: today, tags: ["groceries"],
    }));
    const arabic = await seed(a, "موعد طبيب الأسنان مع نور", "appointment", `موعد مع طبيب الأسنان نور اليوم ${today} لفحص الأسنان.`, { date: today, people: ["نور"], tags: ["أسنان"] });
    const english = await seed(a, "Noor project meeting", "appointment", `Meeting with Noor today ${today} about the solar energy project.`, { date: today, people: ["Noor"], tags: ["solar"] });
    const garden = await seed(a, "خطة زراعة الطماطم", "idea", "أريد زراعة الطماطم في حديقة المنزل في الربيع.", { tags: ["حديقة", "طماطم"] });
    await seed(a, "Passport renewal checklist", "task", "Renew passport before international travel.", { tags: ["passport", "travel"] });
    const bOnly = await seed(b, "Private cobalt submarine", "note", "The cobalt submarine launch code is unique to account B.", { tags: ["cobalt", "submarine"] });
    await seed(b, "Personal hiking route", "note", "Hike the alpine trail on Sunday.", { tags: ["hiking"] });
    await seed(b, "Private receipt", "receipt", "Paid 9999 USD for a telescope.", { date: today, amount: 9999, currency: "USD" });
    const aStatus = await waitIndexed(a);
    await waitIndexed(b);
    t.diagnostic(`Actual storage mode: ${aStatus.mode}; 18 disposable memories indexed across two accounts.`);
    await t.test("English question finds an Arabic memory and Arabic question finds English", async () => {
      const en = await api("/search/related?q=" + encodeURIComponent("When is my dentist appointment?"), a.cookie);
      assert.equal(en.status, 200); assert.ok(en.data.memories.some((row) => row.id === arabic));
      const ar = await api("/search/related?q=" + encodeURIComponent("اجتماع مشروع الطاقة الشمسية"), a.cookie);
      assert.equal(ar.status, 200); assert.ok(ar.data.memories.some((row) => row.id === english));
      const cross = await api("/search/related?q=" + encodeURIComponent("Growing tomatoes in my home garden"), a.cookie);
      assert.equal(cross.status, 200); assert.ok(cross.data.memories.some((row) => row.id === garden));
      assertPrivateStripped(en.data); assertPrivateStripped(ar.data);
    });
    await t.test("exact name, top8, date filters and amounts", async () => {
      const name = await api("/search/related?q=Noor", a.cookie);
      assert.equal(name.status, 200); assert.ok(name.data.memories.some((row) => row.id === english));
      assert.ok(name.data.memories.length <= 8);
      const number = await api("/search/related?q=110&type=receipt&date_from=" + today + "&date_to=" + today, a.cookie);
      assert.equal(number.status, 200); assert.ok(number.data.memories.some((row) => row.id === receiptIds[10]));
      const keyword = await api(`/memories?search=receipt&type=receipt&date_from=${today}&date_to=${today}`, a.cookie);
      assert.equal(keyword.status, 200); assert.equal(keyword.data.length, 11);
      assertPrivateStripped(keyword.data);
      assert.equal((await api("/search/related?q=hello&date_from=2026-02-30", a.cookie)).status, 400);
    });
    await t.test("structured SQL total includes all 11 receipts and grounded source relevance", async () => {
      const result = await ask(a.cookie, { question: `How much did I spend on ${today}?`, language: "en" }, t);
      assert.equal(result.status, 200, "Grounded generation must succeed");
      assert.match(result.data.answer, /660/);
      assert.ok(result.data.source_ids.length > 0 && result.data.source_ids.length <= 8);
      assert.ok(result.data.sources.every((row) => typeof row.relevance === "number"));
      assertPrivateStripped(result.data);
      const week = await ask(a.cookie, { question: "ما المواعيد القادمة هذا الأسبوع؟", language: "ar" }, t);
      assert.equal(week.status, 200);
      assert.ok(week.data.source_ids.length > 0);
      assert.ok(week.data.source_ids.every((id) => [arabic, english].includes(id)));
    });
    await t.test("validated timezone, offset-row local days and separate known/unknown currency totals", async () => {
      assert.equal((await api("/brain/ask", a.cookie, "POST", {
        question: "What is coming today?", language: "en", timezone: "Invalid/Zone",
      })).status, 400);
      const offsetReceipt = await seed(a, "Offset timestamp receipt", "receipt", "Paid 2 GBP at a late-night cafe.", {
        date: `${today}T23:30:00Z`, amount: 2, currency: "GBP",
      });
      await seed(a, "Euro receipt", "receipt", "Paid 20 EUR for stationery.", { date: today, amount: 20, currency: "EUR" });
      await seed(a, "Unknown currency receipt", "receipt", "Paid 30 but currency was not recorded.", { date: today, amount: 30 });
      await waitIndexed(a);
      const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const nextDay = tomorrow.toISOString().slice(0, 10);
      const local = await ask(a.cookie, {
        question: `How much did I spend on ${nextDay}?`, language: "en", timezone: "Asia/Jerusalem",
      }, t);
      assert.equal(local.status, 200); assert.match(local.data.answer, /2/); assert.match(local.data.answer, /GBP|pound/i);
      assert.ok(local.data.source_ids.includes(offsetReceipt));
      const grouped = await ask(a.cookie, {
        question: `How much did I spend on ${today}? Report every currency separately, including unknown currency.`, language: "en", timezone: "UTC",
      }, t);
      assert.equal(grouped.status, 200);
      for (const term of [/660/, /USD|dollar/i, /20/, /EUR|euro/i, /30/, /unknown|unspecified|not (?:recorded|specified)/i, /GBP|pound/i]) assert.match(grouped.data.answer, term);
      assert.doesNotMatch(grouped.data.answer, /(?:grand|combined)\s+total\s*(?:is|of|:)?\s*712/i);
      const dates = await pool.query(`SELECT
        brain_memory_local_date($1,'UTC') AS utc,
        brain_memory_local_date($1,'Asia/Jerusalem') AS local,
        brain_memory_local_date('2026-02-30','UTC') AS invalid,
        brain_memory_local_date($2,'America/Los_Angeles') AS floating`,
      [`${today}T23:30:00Z`, `${today}T09:00:00`]);
      assert.equal(dates.rows[0].utc, today); assert.equal(dates.rows[0].local, nextDay);
      assert.equal(dates.rows[0].floating, today); assert.equal(dates.rows[0].invalid, null);
    });
    await t.test("honest no-answer and no cross-account names, details or similar results", async () => {
      const none = await ask(a.cookie, { question: "What is my intergalactic unicorn license number?", language: "en" }, t);
      assert.equal(none.status, 200); assert.deepEqual(none.data.source_ids, []);
      assert.match(none.data.answer, /couldn't find/i);
      const isolated = await api("/search/related?q=cobalt%20submarine", a.cookie);
      assert.equal(isolated.status, 200); assert.ok(isolated.data.memories.every((row) => row.id !== bOnly));
      assert.equal((await api(`/memories/${bOnly}/similar`, a.cookie)).status, 404);
      assert.equal((await api(`/memories/${bOnly}`, a.cookie)).status, 404);
      const own = await api("/search/related?q=cobalt%20submarine", b.cookie);
      assert.equal(own.status, 200); assert.ok(own.data.memories.some((row) => row.id === bOnly));
      const similar = await api(`/memories/${receiptIds[0]}/similar`, a.cookie);
      assert.equal(similar.status, 200); assert.ok(similar.data.memories.length <= 3);
      assert.ok(similar.data.memories.every((row) => row.id !== receiptIds[0] && row.id !== bOnly));
      assertPrivateStripped(similar.data);
    });
    await t.test("API plain-voice creation and edit autoqueue, user-only reindex, deletion cascades", async () => {
      const captured = await api("/memories", a.cookie, "POST", {
        raw_text: "Synthetic text capture: remember the purple tulip garden.", language: "en", timezone: "UTC",
      });
      assert.equal(captured.status, 201);
      assert.equal((await pool.query("SELECT memory_id FROM memory_embedding_jobs WHERE memory_id=$1", [captured.data.id])).rowCount, 1);
      const created = await api("/capture/voice/plain", a.cookie, "POST", { transcript: "Unique blue sapphire gardening journal.", language: "en" });
      assert.equal(created.status, 201); assertPrivateStripped(created.data);
      const id = created.data.id;
      let job = await pool.query("SELECT version,indexed_version FROM memory_embedding_jobs WHERE memory_id=$1", [id]);
      assert.equal(job.rowCount, 1); assert.notEqual(job.rows[0].version, job.rows[0].indexed_version);
      const changed = await api(`/memories/${id}`, a.cookie, "PATCH", { title: "Unique emerald gardening journal", raw_text: "Plant emerald basil outdoors." });
      assert.equal(changed.status, 200);
      await waitIndexed(a);
      const current = await pool.query("SELECT version,indexed_version FROM memory_embedding_jobs WHERE memory_id=$1", [id]);
      assert.equal(current.rows[0].version, current.rows[0].indexed_version);
      assert.ok(Number(current.rows[0].version) > Number(job.rows[0].version));
      const beforeB = (await pool.query(`SELECT j.memory_id,j.version FROM memory_embedding_jobs j JOIN memories m ON m.id=j.memory_id WHERE m.user_id=$1 ORDER BY memory_id`, [b.id])).rows;
      const reindexed = await api("/indexing/reindex", a.cookie, "POST");
      assert.equal(reindexed.status, 200); assert.equal(reindexed.data.indexed, 0);
      const afterB = (await pool.query(`SELECT j.memory_id,j.version FROM memory_embedding_jobs j JOIN memories m ON m.id=j.memory_id WHERE m.user_id=$1 ORDER BY memory_id`, [b.id])).rows;
      assert.deepEqual(afterB, beforeB);
      assert.equal((await api(`/memories/${id}`, a.cookie, "DELETE")).status, 204);
      assert.equal((await pool.query("SELECT memory_id FROM memory_embedding_jobs WHERE memory_id=$1", [id])).rowCount, 0);
      await waitIndexed(a);
    });
    await t.test("a superseded worker lease cannot write a stale success or failure", async () => {
      const id = receiptIds[0], currentToken = randomUUID(), expiredWorkerToken = randomUUID();
      await pool.query(`UPDATE memory_embedding_jobs SET lease_token=$2,lease_until=now()+interval '90 seconds' WHERE memory_id=$1`, [id, currentToken]);
      const version = (await pool.query("SELECT version FROM memory_embedding_jobs WHERE memory_id=$1", [id])).rows[0].version;
      const staleFailure = await pool.query(`UPDATE memory_embedding_jobs SET attempts=attempts+1,last_error='synthetic stale failure'
        WHERE memory_id=$1 AND version=$2 AND lease_token=$3 AND lease_until>now()`, [id, version, expiredWorkerToken]);
      const staleSuccess = await pool.query(`UPDATE memory_embedding_jobs SET indexed_version=version,lease_until=NULL,lease_token=NULL
        WHERE memory_id=$1 AND version=$2 AND lease_token=$3 AND lease_until>now()`, [id, version, expiredWorkerToken]);
      assert.equal(staleFailure.rowCount, 0); assert.equal(staleSuccess.rowCount, 0);
      await pool.query("UPDATE memory_embedding_jobs SET lease_token=NULL,lease_until=NULL WHERE memory_id=$1 AND lease_token=$2", [id, currentToken]);
    });
    await t.test("transcribe rejects keep_recording without creating files or memories", async () => {
      const before = await pool.query("SELECT count(*)::int AS n FROM memories WHERE user_id=$1", [a.id]);
      const rejected = await api("/voice/transcribe", a.cookie, "POST", {
        audio_base64: "AAAA", mime_type: "audio/wav", language: "en", timezone: "UTC", keep_recording: true,
      });
      assert.equal(rejected.status, 400);
      const after = await pool.query("SELECT count(*)::int AS n FROM memories WHERE user_id=$1", [a.id]);
      assert.equal(after.rows[0].n, before.rows[0].n);
    });
  } finally {
    // Other agents/users can delete their own disposable fixtures during this
    // live run. Measure cleanup itself rather than attributing concurrent
    // activity to this suite's strictly scoped account deletion.
    const beforeCleanup = original.length ? (await pool.query(
      "SELECT count(*)::int AS n FROM memories WHERE id=ANY($1::int[])", [original],
    )).rows[0].n : 0;
    for (const account of accounts) {
      // Only freshly generated test accounts; never reset existing authentication.
      await pool.query("DELETE FROM users WHERE id=$1 AND email=$2", [account.id, account.email]);
      await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [account.id]);
    }
    if (original.length) {
      const remaining = await pool.query("SELECT count(*)::int AS n FROM memories WHERE id=ANY($1::int[])", [original]);
      assert.equal(remaining.rows[0].n, beforeCleanup, "Fixture cleanup must not delete any baseline user memories");
      if (beforeCleanup !== original.length) t.diagnostic(`${original.length - beforeCleanup} baseline memories disappeared during concurrent activity before cleanup; this fixture cleanup removed zero baseline memories.`);
    }
    await pool.end();
  }
});

test("targeted qualified spending and Arabic appointment counts never use global receipt totals", {
  timeout: 180000,
  skip: process.env.SEMANTIC_SCOPE_TEST !== "1" ? "Opt in with SEMANTIC_SCOPE_TEST=1 after restarting the API" : undefined,
}, async (t) => {
  let account;
  try {
    account = await signup("scope");
    assert.equal((await api("/memories/samples", account.cookie, "DELETE")).status, 204);
    const today = new Date().toISOString().slice(0, 10), receipts = [], appointments = [];
    for (let i = 1; i <= 11; i++) {
      const coffee = i <= 2;
      const result = await pool.query(`INSERT INTO memories(user_id,title,type,raw_text,summary,event_date,amount,currency,tags,people,status,confidence)
        VALUES($1,$2,'receipt',$3,$3,$4,$5,'USD',$6,$7,'confirmed',100) RETURNING id`,
      [account.id, coffee ? `Coffee purchase at Acme ${i}` : `Groceries ${i}`,
        coffee ? `Paid ${i * 10} USD for coffee at Acme.` : `Paid ${i * 10} USD for groceries.`,
        today, i * 10, coffee ? ["coffee"] : ["groceries"], coffee ? ["Acme"] : []]);
      receipts.push(result.rows[0].id);
    }
    for (const title of ["موعد طبيب الأسنان", "موعد اجتماع المشروع"]) {
      const result = await pool.query(`INSERT INTO memories(user_id,title,type,raw_text,summary,event_date,status,confidence)
        VALUES($1,$2,'appointment',$2,$2,$3,'confirmed',100) RETURNING id`, [account.id, title, today]);
      appointments.push(result.rows[0].id);
    }
    await pool.query(`INSERT INTO memories(user_id,title,type,raw_text,event_date)
      VALUES($1,'Call the dentist','task','Call the dentist to request a future visit.',$2)`, [account.id, today]);
    const overall = await ask(account.cookie, { question: `How much did I spend on ${today}?`, language: "en" }, t);
    assert.equal(overall.status, 200); assert.match(overall.data.answer, /660/);
    await t.test("coffee and merchant totals are only 30, not the overall 660", async () => {
      for (const qualifier of ["on coffee", "at Acme", "on coffee at Acme"]) {
        const result = await ask(account.cookie, { question: `How much did I spend ${qualifier} on ${today}?`, language: "en" }, t);
        assert.equal(result.status, 200); assert.match(result.data.answer, /30/);
        assert.doesNotMatch(result.data.answer, /660/);
        assert.ok(result.data.source_ids.length > 0);
        assert.ok(result.data.source_ids.every((id) => receipts.slice(0, 2).includes(id)));
      }
    });
    await t.test("unknown rocket-fuel qualifier gives honest no-answer, never overall spending", async () => {
      const result = await ask(account.cookie, { question: `How much did I spend on rocket fuel on ${today}?`, language: "en" }, t);
      assert.equal(result.status, 200); assert.deepEqual(result.data.source_ids, []);
      assert.match(result.data.answer, /couldn't find/i); assert.doesNotMatch(result.data.answer, /660/);
    });
    await t.test("Arabic كم موعد counts appointments rather than receipt spending", async () => {
      const result = await ask(account.cookie, { question: "كم موعد عندي هذا الأسبوع؟", language: "ar", timezone: "UTC" }, t);
      assert.equal(result.status, 200);
      assert.match(result.data.answer, /2|٢|موعدين|موعدان|موعدَين|موعدَيْن|اثن/);
      assert.doesNotMatch(result.data.answer, /660|٦٦٠/);
      assert.ok(result.data.source_ids.length > 0 && result.data.source_ids.every((id) => appointments.includes(id)));
    });
  } finally {
    if (account) {
      await pool.query("DELETE FROM users WHERE id=$1 AND email=$2", [account.id, account.email]);
      await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [account.id]);
    }
    await pool.end();
  }
});