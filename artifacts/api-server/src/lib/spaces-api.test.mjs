// Actual API/Gemini integration, run ONLY after the parent restarts packaged API:
// SPACES_API_TEST=1 node --test artifacts/api-server/src/lib/spaces-api.test.mjs
// Creates isolated test accounts; never alters pre-existing accounts or data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";

const base = process.env.SPACES_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "8080"}/api`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function account(language) {
  const password = `Spaces-${randomUUID()}`;
  const email = `spaces-live-${randomUUID()}@example.test`;
  const result = await fetch(`${base}/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Spaces ${language} isolated integration`, language, theme: "dark" }) });
  assert.equal(result.status, 201, `Isolated ${language} account signup failed`);
  const cookie = result.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const user = (await result.json()).user;
  async function api(path, method = "GET", data, status = 200) {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    const body = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${body?.error ?? response.status}`);
    return body;
  }
  await api("/memories/samples", "DELETE", undefined, 204); // Only newly created fixture samples, not anyone else's memories.
  console.log(`Created isolated ${language} fixture owner ${user.id}`);
  return { api, user, password };
}
async function memory(api, text, metadata, spaceId) {
  const saved = await api("/capture/voice/plain", "POST", { transcript: text, language: /[ء-ي]/.test(text) ? "ar" : "en", ...(spaceId ? { space_id: spaceId } : {}) }, 201);
  return metadata ? await api(`/memories/${saved.id}`, "PATCH", metadata) : saved;
}
async function eventually(check, description, timeout = 600_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await wait(5000);
  } while (Date.now() < deadline);
  throw new Error(`${description}: no real provider result within ${timeout / 1000}s. Inspect durable jobs/budgets; no fabricated fallback accepted.`);
}
test("live EN/AR and cross-language real Gemini membership, creation cards, terminal dismissal, owner isolation, Ask and safe deletion", {
  skip: process.env.SPACES_API_TEST !== "1" ? "Requires parent restart; opt in with SPACES_API_TEST=1" : undefined,
  timeout: 1_200_000,
}, async () => {
  const a = await account("en"), b = await account("ar");
  let bDeleted = false;
  try {
  const sara = (await a.api("/spaces", "POST", { kind: "person", name: "Sara", description: "Meetings and contact notes about Sara / سارة", pinned: true }, 201)).space;
  const trip = (await a.api("/spaces", "POST", { kind: "trip", name: "Jordan Trip", description: "Our upcoming journey to Jordan / رحلة الأردن", color: "amber" }, 201)).space;
  const project = (await a.api("/spaces", "POST", { kind: "project", name: "Website Project", description: "Building our website." }, 201)).space;
  const en = await memory(a.api, "Sara prefers morning meetings. Her email is sara@example.com.", { people: ["Sara"], tags: ["meeting"] });
  const ar = await memory(a.api, "سارة تفضل الاجتماعات الصباحية. سأناقش معها خطة العمل غداً.", { people: ["سارة"], tags: ["اجتماع"] });
  const jordan = await memory(a.api, "رحلة الأردن: حجز الفندق في عمّان وزيارة البتراء الأسبوع القادم.", { people: [], tags: ["الأردن", "رحلة"] });
  const web = await memory(a.api, "Website Project: review the new homepage and publish it next week.", { type: "task", tags: ["Website Project"] });
  const repeated = [];
  for (const text of ["Atlas Project: approve the initial plan.", "Atlas Project: review the budget.", "Atlas Project: prepare the launch notes."]) {
    repeated.push(await memory(a.api, text, { tags: ["Atlas Project", "Planning topic"] }));
  }
  const before = await a.api("/spaces");
  const creation = (await a.api("/spaces/suggestions")).suggestions;
  const atlas = creation.find((s) => s.name === "Atlas Project"), planning = creation.find((s) => s.name === "Planning topic");
  assert.ok(atlas && planning, "Repeated 3+ own tags must create persistent cards");
  assert.equal((await a.api("/spaces")).spaces.length, before.spaces.length, "No automatic Space creation");
  await a.api(`/spaces/suggestions/${planning.id}/dismiss`, "POST", {}, 204);
  assert.ok(!(await a.api("/spaces/suggestions")).suggestions.some((s) => s.id === planning.id));
  await a.api(`/spaces/suggestions/${planning.id}/confirm`, "POST", {}, 409);
  const atlasSpace = (await a.api(`/spaces/suggestions/${atlas.id}/confirm`, "POST", {})).space;
  assert.equal(atlasSpace.kind, "project");
  const pairs = [[en, sara, "English Sara"], [ar, sara, "Arabic-to-English Sara"], [jordan, trip, "Arabic-to-English Jordan"],
    [web, project, "English project"], [repeated[0], atlasSpace, "New Space queues existing memory"]];
  const evidence = [];
  for (const [m, space, label] of pairs) {
    const suggestion = await eventually(async () => (await a.api(`/memories/${m.id}/space-suggestions`)).suggestions.find((s) => s.space.id === space.id), label);
    assert.ok(suggestion.confidence >= 75);
    assert.ok(/[ء-ي]/.test(m.raw_text) ? /[ء-ي]/.test(suggestion.reason) : !/[ء-ي]/.test(suggestion.reason), "Reason must retain original memory language");
    evidence.push({ label, memory_id: m.id, space_id: space.id, reason: suggestion.reason, confidence: suggestion.confidence });
    console.log(`Real Gemini passed: ${label}, confidence ${suggestion.confidence}; ${suggestion.reason}`);
  }
  await a.api(`/spaces/${sara.id}/memories`, "POST", { memory_id: en.id }, 204);
  await a.api(`/spaces/${project.id}/memories`, "POST", { memory_id: en.id }, 204);
  assert.equal((await a.api(`/memories/${en.id}/spaces`)).spaces.length, 2);
  const profile = (await a.api(`/spaces/${sara.id}`)).profile;
  assert.ok(profile.items.some((i) => i.memory_id === en.id && i.value === "sara@example.com"));
  const item = profile.items[0];
  await a.api(`/spaces/${sara.id}/profile/${item.id}`, "DELETE", undefined, 204);
  assert.ok(!(await a.api(`/spaces/${sara.id}`)).profile.items.some((i) => i.id === item.id));
  assert.equal((await a.api(`/memories/${en.id}`)).raw_text, en.raw_text);
  await a.api(`/spaces/${sara.id}/memories/${ar.id}`, "DELETE", undefined, 204);
  await a.api(`/memories/${ar.id}`, "PATCH", { summary: "سارة: متابعة خطة الاجتماعات الصباحية." });
  await wait(20_000);
  assert.ok(!(await a.api(`/memories/${ar.id}/space-suggestions`)).suggestions.some((s) => s.space.id === sara.id));
  await a.api(`/spaces/${sara.id}/memories`, "POST", { memory_id: ar.id }, 409);
  for (const path of [`/spaces/${sara.id}`, `/spaces/${sara.id}/memories`, `/memories/${en.id}/spaces`, `/memories/${en.id}/space-suggestions`]) {
    await b.api(path, "GET", undefined, 404);
  }
  await b.api(`/spaces/${sara.id}`, "PATCH", { name: "not allowed" }, 404);
  await b.api(`/spaces/${sara.id}`, "DELETE", undefined, 404);
  await b.api("/capture/voice/plain", "POST", { transcript: "يجب ألا تُحفظ", language: "ar", space_id: sara.id }, 404);
  await b.api("/memories", "POST", { raw_text: "must not save", language: "en", space_id: sara.id }, 404);
  await b.api("/capture/voice", "POST", { audio_base64: "AAAA", mime_type: "audio/wav", language: "ar", timezone: "UTC", space_id: sara.id }, 404);
  await b.api("/brain/ask", "POST", { question: "What is here?", language: "en", space_id: sara.id }, 404);
  const inside = await memory(a.api, "Website Project receipt: lunch cost 12 USD.", { type: "receipt", amount: 12, currency: "USD", tags: ["Website Project"] }, project.id);
  const outside = await memory(a.api, "Unrelated furniture receipt: 900 USD.", { type: "receipt", amount: 900, currency: "USD", tags: ["furniture"] });
  const total = await a.api("/brain/ask", "POST", { question: "What is my total spending?", language: "en", space_id: project.id });
  assert.ok(!total.source_ids.includes(outside.id));
  assert.ok(/12/.test(total.answer) && !/900|912/.test(total.answer), "SQL total must exclude outside receipts");
  const hop = await memory(a.api, "Website Project follow-up: the project codename is Golden Birch.", { tags: ["Website Project"] });
  await a.api(`/memories/${inside.id}/connections`, "POST", { other_id: hop.id, relation_type: "follow_up", reason: "An explicit follow-up to the Website Project lunch receipt." }, 201);
  const answer = await a.api("/brain/ask", "POST", { question: "What codename is in the confirmed follow-up connected to the Website Project lunch receipt for 12 USD?", language: "en", space_id: project.id });
  assert.ok(answer.source_ids.includes(hop.id), "Confirmed one-hop context outside Space must be permitted");
  assert.ok(/Golden Birch/i.test(answer.answer));
  assert.ok(!answer.source_ids.includes(outside.id));
  const arAnswer = await a.api("/brain/ask", "POST", { question: "ما الذي تفضله سارة بخصوص الاجتماعات؟", language: "ar", space_id: sara.id });
  assert.ok(/[ء-ي]/.test(arAnswer.answer));
  assert.ok(!arAnswer.source_ids.includes(outside.id));
  const exported = await a.api("/brain/export");
  assert.ok(exported.spaces.some((s) => s.id === sara.id));
  assert.ok(exported.space_memories.some((sm) => sm.space_id === sara.id && sm.memory_id === en.id));
  await a.api(`/spaces/${project.id}`, "DELETE", undefined, 204);
  assert.equal((await a.api(`/memories/${inside.id}`)).id, inside.id);
  assert.equal((await a.api(`/memories/${en.id}`)).id, en.id);
  const bSpace = (await b.api("/spaces", "POST", { kind: "topic", name: "مساحة اختبار مستقلة" }, 201)).space;
  const bMemory = await memory(b.api, "ملاحظة في حساب الاختبار المستقل", undefined, bSpace.id);
  await b.api("/brain/data", "DELETE", { confirmation: "DELETE" });
  assert.equal((await b.api("/spaces")).spaces.length, 0);
  await b.api(`/memories/${bMemory.id}`, "GET", undefined, 404);
  assert.equal((await a.api(`/spaces/${sara.id}`)).space.id, sara.id);
  await b.api("/auth/account", "DELETE", { confirmation: "DELETE", password: b.password }, 204);
  bDeleted = true;
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/spaces-live-evidence.json", JSON.stringify({ user_id: a.user.id, spaces: [sara.id, trip.id, atlasSpace.id], evidence, total, answer, arAnswer }, null, 2));
  console.log("Real Spaces integration passed. Evidence: tmp/spaces-live-evidence.json");
  } finally {
    if (!bDeleted) await b.api("/auth/account", "DELETE", { confirmation: "DELETE", password: b.password }, 204);
    await a.api("/auth/account", "DELETE", { confirmation: "DELETE", password: a.password }, 204);
    console.log("Only this suite's disposable accounts cleaned up.");
  }
});