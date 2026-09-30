import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";

const enabled = process.env.CONNECTIONS_API_TEST === "1";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(async () => { await pool.end(); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(account, path, method = "GET", body) {
  const response = await fetch(`http://localhost:80/api${path}`, {
    signal: AbortSignal.timeout(30000),
    method, headers: { ...(account ? { Cookie: account.cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, response };
}
async function signup(language) {
  const email = `dots-${language}-${randomUUID()}@example.test`;
  const result = await api(undefined, "/auth/signup", "POST", { email, password: `Dots-${randomUUID()}-9a!`, name: "Disposable dots fixture", language, theme: "system" });
  assert.equal(result.status, 201);
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
  const row = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  return { id: row.rows[0].id, email, cookie };
}
async function insert(account, title, type = "note", raw = title, extra = {}) {
  const result = await pool.query(`INSERT INTO memories(user_id,title,type,raw_text,status,extra)
    VALUES($1,$2,$3,$4,'confirmed',$5) RETURNING id`, [account.id, title, type, raw, extra]);
  return result.rows[0].id;
}
async function waitFor(account, predicate, timeout = 240000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await sleep(2500);
  }
  const failures = await pool.query(`SELECT last_error FROM connection_discovery_jobs WHERE user_id=$1 AND last_error IS NOT NULL`, [account.id]);
  throw new Error(`Connection fixture timed out. Safe discovery diagnostics: ${JSON.stringify(failures.rows)}`);
}
const pair = (a, b) => [a, b].sort((x, y) => x - y).join(":");
async function cleanAccounts(accounts) {
  for (const account of accounts) {
    await pool.query("DELETE FROM users WHERE id=$1 AND email=$2", [account.id, account.email]);
    await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [account.id]);
    await pool.query("DELETE FROM ai_usage_limits WHERE scope=ANY($1::text[])", [[`interactive:${account.id}`, `worker:${account.id}`]]);
  }
}

test("live connections: real EN/AR/cross-language discovery, daily cap, terminal dismissal, isolation and merge", {
  timeout: 720000, skip: enabled ? undefined : "Opt in CONNECTIONS_API_TEST=1 after parent restarts the already-managed API",
}, async () => {
  const accounts = [];
  try {
    const a = await signup("en"); accounts.push(a);
    const b = await signup("ar"); accounts.push(b);
    assert.equal((await api(undefined, "/connections/suggestions")).status, 401);
    for (const owner of accounts) {
      assert.deepEqual((await api(owner, "/connections/settings")).data, { automatic: true, confirmed_count: 0 });
      assert.equal((await api(owner, "/connections/settings", "PATCH", { automatic: false })).data.automatic, false);
      assert.equal((await api(owner, "/memories/samples", "DELETE")).status, 204, "Remove only this disposable account's onboarding samples");
    }
    const doctor = await insert(a, "Doctor appointment Oct 10", "appointment", "Doctor appointment Oct 10 with Dr Amal for blood tests at Cedar Clinic.");
    const blood = await insert(a, "نتائج تحليل الدم", "document", "نتائج تحليل الدم من عيادة سيدار طلبتها الطبيبة أمل في موعد 10 أكتوبر.");
    const receipt = await insert(a, "Laptop receipt", "receipt", "Receipt ACME-882, Acer Swift laptop serial SW123, purchased Oct 1 for USD 900 at Acme.");
    const warranty = await insert(a, "Laptop warranty", "document", "Acer Swift laptop serial SW123 warranty at Acme for receipt ACME-882 purchased Oct 1.");
    const duplicate = await insert(a, "Copy of laptop receipt ACME-882", "receipt", "Receipt ACME-882, Acer Swift laptop serial SW123, purchased Oct 1 for USD 900 at Acme.");
    const unrelated = [await insert(a, "Banana bread recipe", "note", "Two bananas, flour and cinnamon. Bake 35 minutes."),
      await insert(a, "Beach walk", "note", "Walked on the beach at sunrise and watched seabirds.")];
    const arDoctor = await insert(b, "موعد الطبيبة أمل 10 أكتوبر", "appointment", "زيارة الطبيبة أمل في عيادة سيدار يوم 10 أكتوبر لطلب تحليل الدم.");
    const arBlood = await insert(b, "نتائج تحليل الدم", "document", "نتائج تحليل الدم الذي طلبته الطبيبة أمل في عيادة سيدار في موعد 10 أكتوبر.");
    await waitFor(a, async () => {
      const result = await api(a, "/indexing/status");
      return result.status === 200 && result.data.indexed === result.data.total;
    });
    await waitFor(b, async () => {
      const result = await api(b, "/indexing/status");
      return result.status === 200 && result.data.indexed === result.data.total;
    });
    assert.deepEqual((await api(a, "/connections/suggestions")).data.suggestions, [], "auto-off never discovers");
    assert.equal((await api(a, "/connections/discover", "POST")).status, 202);
    assert.equal((await api(b, "/connections/discover", "POST")).status, 202);
    const linksA = await waitFor(a, async () => {
      const links = (await api(a, "/connections/suggestions")).data.suggestions;
      return links?.length === 3 && links;
    });
    const linksB = await waitFor(b, async () => {
      const links = (await api(b, "/connections/suggestions")).data.suggestions;
      return links?.some((link) => pair(link.memory_a.id, link.memory_b.id) === pair(arDoctor, arBlood)) && links;
    });
    console.info("Actual Gemini proposals", JSON.stringify([...linksA, ...linksB].map((link) => ({
      source: link.source, a: link.memory_a.title, b: link.memory_b.title,
      relation: link.relation_type, confidence: link.confidence, reason: link.reason,
    }))));
    assert.ok(linksB.every((link) => /[ء-ي]/.test(link.reason)), "Arabic reasons localized");
    assert.ok(linksA.some((link) => pair(link.memory_a.id, link.memory_b.id) === pair(doctor, blood)), "English/Arabic medical follow-up");
    assert.ok(linksA.some((link) => pair(link.memory_a.id, link.memory_b.id) === pair(receipt, warranty)
      || pair(link.memory_a.id, link.memory_b.id) === pair(duplicate, warranty)), "laptop receipt/warranty");
    const dupLink = linksA.find((link) => link.relation_type === "duplicate" && pair(link.memory_a.id, link.memory_b.id) === pair(receipt, duplicate));
    assert.ok(dupLink, "same receipt detected as duplicate");
    assert.ok(linksA.every((link) => !unrelated.includes(link.memory_a.id) && !unrelated.includes(link.memory_b.id)));
    assert.equal(/"(?:embedding|user_id|userId|lease_token|password_hash)"\s*:/.test(JSON.stringify(linksA)), false);
    for (const method of ["confirm", "dismiss"]) assert.equal((await api(b, `/connections/${dupLink.id}/${method}`, "POST")).status, 404);
    assert.equal((await api(b, `/memories/${doctor}/connections`)).status, 404);
    assert.equal((await api(a, `/memories/${doctor}/connections`, "POST", { other_id: arBlood })).status, 404);
    // DB ownership and pair constraints, not merely API-side filters.
    await assert.rejects(pool.query(`INSERT INTO memory_links(user_id,memory_a_id,memory_b_id,source,status,relation_type,confidence)
      VALUES($1,$2,$3,'manual','confirmed','other',100)`, [a.id, Math.min(doctor, arBlood), Math.max(doctor, arBlood)]), /foreign key/i);
    const medical = linksA.find((link) => pair(link.memory_a.id, link.memory_b.id) === pair(doctor, blood));
    assert.equal((await api(a, `/connections/${medical.id}/dismiss`, "POST")).data.connection.status, "dismissed");
    assert.equal((await api(a, `/connections/${medical.id}/confirm`, "POST")).status, 409);
    assert.equal((await api(a, `/memories/${doctor}/connections`, "POST", { other_id: blood })).status, 409);
    const quotaBefore = (await pool.query("SELECT used FROM connection_daily_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date", [a.id])).rows[0].used;
    assert.equal(quotaBefore, 3);
    await api(a, "/connections/discover", "POST");
    await sleep(10000);
    assert.equal((await api(a, "/connections/suggestions")).data.suggestions.some((link) => link.id === medical.id), false);
    assert.equal((await pool.query("SELECT used FROM connection_daily_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date", [a.id])).rows[0].used, 3);
    // Manual links do not spend AI suggestion quota. Move and deduplicate while
    // preserving a terminal dismissed target, and preserve keep-ID content.
    const manual1 = await api(a, `/memories/${duplicate}/connections`, "POST", { other_id: unrelated[0], reason: "User supplied relation" });
    assert.equal(manual1.status, 201);
    const manual2 = await api(a, `/memories/${receipt}/connections`, "POST", { other_id: unrelated[0] });
    await api(a, `/connections/${manual2.data.connection.id}`, "DELETE");
    await api(a, `/memories/${duplicate}/connections`, "POST", { other_id: unrelated[1] });
    const before = (await api(a, `/memories/${receipt}`)).data;
    assert.equal((await api(a, `/connections/${dupLink.id}/merge`, "POST", { keep_memory_id: receipt })).status, 400);
    assert.equal((await api(a, `/connections/${dupLink.id}/merge`, "POST", { keep_memory_id: unrelated[0], confirm: true })).status, 400);
    assert.equal((await api(b, `/connections/${dupLink.id}/merge`, "POST", { keep_memory_id: receipt, confirm: true })).status, 404);
    const merged = await api(a, `/connections/${dupLink.id}/merge`, "POST", { keep_memory_id: receipt, confirm: true });
    assert.equal(merged.status, 200); assert.deepEqual(merged.data.memory, before);
    assert.equal((await api(a, `/memories/${duplicate}`)).status, 404);
    const transferred = (await api(a, `/memories/${receipt}/connections`)).data;
    assert.ok(transferred.confirmed.some((link) => [link.memory_a.id, link.memory_b.id].includes(unrelated[1])));
    assert.ok(!transferred.confirmed.some((link) => [link.memory_a.id, link.memory_b.id].includes(unrelated[0])));
    assert.equal((await api(a, "/connections/settings")).data.confirmed_count, transferred.confirmed.length);
    // Personal-data deletion preserves the day counter, so it cannot reset cap.
    assert.equal((await api(a, "/brain/data", "DELETE", { confirmation: "DELETE" })).status, 200);
    assert.equal((await pool.query("SELECT used FROM connection_daily_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date", [a.id])).rows[0].used, 3);
    assert.deepEqual((await api(a, "/connections/suggestions")).data.suggestions, []);
    assert.equal((await api(a, "/connections/settings")).data.automatic, false);
    // Actual weekly Forgotten Ideas passes in both languages. Use a fresh
    // disposable account for English rather than resetting the first daily cap.
    const c = await signup("en"); accounts.push(c);
    await api(c, "/connections/settings", "PATCH", { automatic: false });
    await api(c, "/memories/samples", "DELETE");
    for (const [owner, language] of [[c, "en"], [b, "ar"]]) {
      const idea = await insert(owner, language === "ar" ? "فكرة حديقة نعناع على الشرفة" : "Balcony mint garden idea", "idea",
        language === "ar" ? "فكرة إنشاء حديقة نعناع على الشرفة باستخدام أصص وبذور نعناع." : "Create a balcony mint herb garden using planters and mint seeds.");
      const recent = await insert(owner, language === "ar" ? "شراء أصص وبذور نعناع" : "Mint garden supplies purchased", "note",
        language === "ar" ? "اشتريت أصصا وبذور نعناع لإنشاء حديقة نعناع على الشرفة." : "Bought planters and mint seeds to create the balcony mint herb garden.");
      await pool.query("UPDATE memories SET created_at=now()-interval '40 days' WHERE user_id=$1 AND id=$2", [owner.id, idea]);
      await waitFor(owner, async () => {
        const result = await api(owner, "/indexing/status");
        return result.status === 200 && result.data.indexed === result.data.total;
      });
      await api(owner, "/connections/settings", "PATCH", { automatic: true });
      const expected = language === "ar"
        ? "كتبت هذه الفكرة منذ فترة، وحفظت مؤخراً شيئاً ذا صلة."
        : "You wrote this idea a while ago, and you recently saved something related.";
      const forgotten = await waitFor(owner, async () => {
        const links = (await api(owner, "/connections/suggestions")).data.suggestions;
        return links?.find((link) => pair(link.memory_a.id, link.memory_b.id) === pair(idea, recent) && link.reason === expected);
      });
      console.info("Actual weekly forgotten-idea proposal", JSON.stringify({ language, source: forgotten.source,
        a: forgotten.memory_a.title, b: forgotten.memory_b.title, confidence: forgotten.confidence, reason: forgotten.reason }));
      const schedule = (await pool.query("SELECT next_weekly_at>now()+interval '6 days' AS persisted FROM connection_settings WHERE user_id=$1", [owner.id])).rows[0];
      assert.equal(schedule.persisted, true);
    }
  } finally {
    await cleanAccounts(accounts);
  }
});

test("live weekly: persisted English/Arabic forgotten-idea discovery uses actual Gemini", {
  timeout: 360000, skip: process.env.CONNECTIONS_WEEKLY_TEST === "1" ? undefined : "Opt in CONNECTIONS_WEEKLY_TEST=1",
}, async () => {
  const accounts = [];
  try {
    for (const language of ["en", "ar"]) {
      const owner = await signup(language); accounts.push(owner);
      await api(owner, "/connections/settings", "PATCH", { automatic: false });
      await api(owner, "/memories/samples", "DELETE");
      const idea = await insert(owner, language === "ar" ? "فكرة حديقة نعناع على الشرفة" : "Balcony mint garden idea", "idea",
        language === "ar" ? "فكرة إنشاء حديقة نعناع على الشرفة باستخدام أصص وبذور نعناع." : "Create a balcony mint herb garden using planters and mint seeds.");
      const recent = await insert(owner, language === "ar" ? "شراء أصص وبذور نعناع" : "Mint garden supplies purchased", "note",
        language === "ar" ? "اشتريت أصصا وبذور نعناع لإنشاء حديقة نعناع على الشرفة." : "Bought planters and mint seeds to create the balcony mint herb garden.");
      const stale = await insert(owner, language === "ar" ? "تجهيزات قديمة للحديقة" : "Old garden supplies", "note",
        language === "ar" ? "أصص وبذور نعناع لإنشاء حديقة نعناع على الشرفة." : "Planters and mint seeds for the balcony mint herb garden.");
      await pool.query("UPDATE memories SET created_at=now()-interval '40 days' WHERE user_id=$1 AND id=ANY($2::int[])", [owner.id, [idea, stale]]);
      await waitFor(owner, async () => {
        const result = await api(owner, "/indexing/status");
        return result.status === 200 && result.data.indexed === result.data.total;
      });
      await api(owner, "/connections/settings", "PATCH", { automatic: true });
      const expected = language === "ar" ? "كتبت هذه الفكرة منذ فترة، وحفظت مؤخراً شيئاً ذا صلة."
        : "You wrote this idea a while ago, and you recently saved something related.";
      const forgotten = await waitFor(owner, async () => {
        const links = (await api(owner, "/connections/suggestions")).data.suggestions;
        assert.ok(!links?.some((link) => link.reason === expected && [link.memory_a.id, link.memory_b.id].includes(stale)),
          "weekly forgotten pass must not match old candidates");
        return links?.find((link) => pair(link.memory_a.id, link.memory_b.id) === pair(idea, recent) && link.reason === expected);
      });
      console.info("Actual weekly proposal", JSON.stringify({ language, source: forgotten.source,
        a: forgotten.memory_a.title, b: forgotten.memory_b.title, confidence: forgotten.confidence, reason: forgotten.reason }));
      assert.equal((await pool.query("SELECT next_weekly_at>now()+interval '6 days' AS persisted FROM connection_settings WHERE user_id=$1", [owner.id])).rows[0].persisted, true);
    }
  } finally { await cleanAccounts(accounts); }
});

test("targeted live duplicate guard: receipt copy merges, warranty remains distinct", {
  timeout: 300000, skip: process.env.CONNECTIONS_DUPLICATE_TEST === "1" ? undefined : "Opt in CONNECTIONS_DUPLICATE_TEST=1 after final API restart",
}, async () => {
  const accounts = [];
  try {
    const owner = await signup("en"); accounts.push(owner);
    await api(owner, "/connections/settings", "PATCH", { automatic: false });
    await api(owner, "/memories/samples", "DELETE");
    const text = "Receipt ACME-882, Acer Swift laptop serial SW123, purchased Oct 1 for USD 900 at Acme.";
    const receipt = await insert(owner, "Laptop receipt ACME-882", "receipt", text);
    const copy = await insert(owner, "Copy of laptop receipt ACME-882", "receipt", text);
    const warranty = await insert(owner, "Laptop warranty", "document",
      "Warranty certificate for Acer Swift laptop serial SW123, referring to purchase receipt ACME-882 from Acme on Oct 1. Provides one year repair coverage; this is not a receipt.");
    await waitFor(owner, async () => {
      const response = await api(owner, "/indexing/status");
      return response.status === 200 && response.data.indexed === response.data.total;
    });
    assert.equal((await api(owner, "/connections/discover", "POST")).status, 202);
    const duplicate = await waitFor(owner, async () => {
      const links = (await api(owner, "/connections/suggestions")).data.suggestions;
      assert.ok(links.every((link) => link.relation_type !== "duplicate" || ![link.memory_a.id, link.memory_b.id].includes(warranty)),
        "warranty must never be offered as a receipt duplicate");
      return links.find((link) => link.relation_type === "duplicate" && pair(link.memory_a.id, link.memory_b.id) === pair(receipt, copy));
    });
    const meaningful = await waitFor(owner, async () => {
      const links = (await api(owner, "/connections/suggestions")).data.suggestions;
      return links.some((link) => [link.memory_a.id, link.memory_b.id].includes(warranty) && link.relation_type !== "duplicate") && links;
    });
    console.info("Targeted actual Gemini proposals", JSON.stringify(meaningful.map((link) => ({
      source: link.source, a: link.memory_a.title, b: link.memory_b.title,
      relation: link.relation_type, confidence: link.confidence, reason: link.reason,
    }))));
    const before = (await api(owner, `/memories/${receipt}`)).data;
    assert.equal((await api(owner, `/connections/${duplicate.id}/merge`, "POST", { keep_memory_id: receipt })).status, 400);
    const merged = await api(owner, `/connections/${duplicate.id}/merge`, "POST", { keep_memory_id: receipt, confirm: true });
    assert.equal(merged.status, 200); assert.deepEqual(merged.data.memory, before);
    assert.equal((await api(owner, `/memories/${copy}`)).status, 404);
    assert.equal((await api(owner, `/memories/${warranty}`)).status, 200);
  } finally { await cleanAccounts(accounts); }
});