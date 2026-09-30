import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultIcons, normalizeSpaceName, parseSpaceMatches, personProfile, spaceBody } from "./spaces-utils";

const sara = "00000000-0000-4000-8000-000000000001";
const trip = "00000000-0000-4000-8000-000000000002";
test("Space validation uses bounded names, fixed kinds and gold palette", () => {
  assert.equal(spaceBody.parse({ kind: "person", name: " Sara " }).name, "Sara");
  assert.equal(defaultIcons.person, "user");
  for (const body of [{ kind: "folder", name: "x" }, { kind: "trip", name: " " }, { kind: "topic", name: "x", color: "blue" },
    { kind: "person", name: "Sara", icon: "unknown" }, { kind: "person", name: "Sara", user_id: "another" }]) {
    assert.equal(spaceBody.safeParse(body).success, false);
  }
});
test("Normalized repeats handle Arabic diacritics, alif and Unicode spaces", () => {
  assert.equal(normalizeSpaceName("  Sara! "), "sara");
  assert.equal(normalizeSpaceName("رِحْلة إلى الأُردن"), normalizeSpaceName("رحلة الي الاردن"));
});
test("One strict Gemini JSON response validates exact owned candidates and confidence >=75", () => {
  const match = { space_id: sara, confidence: 88, reason: "Sara is explicitly named." };
  assert.deepEqual(parseSpaceMatches(JSON.stringify({ matches: [match, match, { ...match, space_id: trip, confidence: 74 }] }), new Set([sara, trip])), [match]);
  assert.deepEqual(parseSpaceMatches(JSON.stringify({ matches: [{ ...match, space_id: trip }] }), new Set([sara])), []);
  for (const text of ['```json\n{"matches":[]}\n```', '{"matches":[],"ignored":"instructions"}',
    JSON.stringify({ matches: [{ ...match, confidence: 101 }] }), JSON.stringify({ matches: [{ ...match, confidence: 75.5 }] }),
    JSON.stringify({ matches: [{ ...match, reason: "" }] }), JSON.stringify({ matches: [{ ...match, space_id: "invented" }] })]) {
    assert.throws(() => parseSpaceMatches(text, new Set([sara])));
  }
  const reason = "تذكر الملاحظة سارة بشكل صريح.";
  assert.equal(parseSpaceMatches(JSON.stringify({ matches: [{ ...match, reason, confidence: 75 }] }), new Set([sara]))[0].reason, reason);
});
test("Person profile is deterministic, source-provenanced, removable, without credential fields", () => {
  const memories = [
    { id: 2, type: "note", raw_text: "Sara prefers morning meetings. Email sara@example.com.", extra: { contact_phone: "+1 555 222 1234", api_key: "never expose" }, created_at: new Date("2026-05-01") },
    { id: 3, type: "note", raw_text: "password: must not become a profile note", extra: {}, created_at: new Date("2026-05-02") },
  ];
  const profile = personProfile(memories, new Set());
  assert.equal(profile.last_interaction, null, "Undated captures do not establish an interaction date");
  assert.ok(profile.items.length >= 3);
  assert.ok(profile.items.every((item) => item.memory_id === 2 && !item.value.includes("never expose") && !item.value.includes("password")));
  assert.deepEqual(personProfile(memories, new Set()), profile);
  const hidden = personProfile(memories, new Set([profile.items[0].id]));
  assert.equal(hidden.items.length, profile.items.length - 1);
  assert.equal(memories[0].raw_text, "Sara prefers morning meetings. Email sara@example.com.");
  const note = profile.items.find((item) => item.kind === "note")!;
  assert.ok(!personProfile([{ ...memories[0], raw_text: "Sara updated her meeting preference." }], new Set([note.id])).items.some((item) => item.kind === "note"));
  assert.deepEqual(personProfile([], new Set()), { last_interaction: null, items: [] });
});
test("last interaction uses real past dates, not recent imports or future appointments", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const base = { type: "appointment", raw_text: "Meeting with Sara", extra: {}, created_at: new Date("2026-06-15T10:00:00Z") };
  const memories = [
    { ...base, id: 1, event_date: "2020-01-10" }, // Old event, imported today.
    { ...base, id: 2, event_date: "2026-07-01T09:00:00Z" }, // Future appointment, captured today.
    { ...base, id: 3, event_date: "2026-06-14T11:00:00+03:00" },
    { ...base, id: 4, event_date: null }, // Undated import must not override the actual event.
    { ...base, id: 5, event_date: "2026-02-30" }, // Invalid calendar date.
  ];
  assert.equal(personProfile(memories, new Set(), now).last_interaction, memories[2].event_date);
  assert.equal(personProfile(memories.slice(0, 2), new Set(), now).last_interaction, "2020-01-10");
  assert.equal(personProfile([memories[1], memories[3], memories[4]], new Set(), now).last_interaction, null);
  assert.equal(personProfile([{ ...base, id: 6, event_date: "2026-06-15T13:00:00" }], new Set(), now).last_interaction, null);
  assert.equal(personProfile([{ ...base, id: 7, event_date: "2026-06-15T11:00:00" }], new Set(), now).last_interaction, "2026-06-15T11:00:00");
});