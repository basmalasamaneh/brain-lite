import assert from "node:assert/strict";
import { test } from "node:test";
import { GetMemoryResponse, SearchRelatedResponse, AskBrainResponse } from "@workspace/api-zod";
import { buildEmbeddingText, cosine, exactBoost, financialQualifiers, localCalendarDate, numberWords, queryTokens, retryDelay, structuredIntent, validDateFilter, validTimezone } from "./semantic-utils";

const memory = {
  id: 1, is_sample: false, type: "receipt", title: "Dinner with Noor", summary: "عشاء مع نور", raw_text: "Paid 120",
  transcript: "Paid 120", event_date: "2026-09-30", amount: 120, currency: "USD", people: ["Noor"],
  tags: ["dinner"], confidence: 100, status: "confirmed", file_path: null, extra: {},
  extraction_status: "extracted", extraction_error: null, created_at: "2026-09-30T12:00:00.000Z",
};
test("document text preserves multilingual facts, dates, amounts and transcript with word forms", () => {
  const text = buildEmbeddingText(memory);
  for (const phrase of ["Noor", "عشاء", "September", "one hundred twenty", "USD", "Paid 120", "dinner"]) assert.ok(text.includes(phrase));
  assert.equal(numberWords(1250), "one thousand two hundred fifty");
  assert.equal(numberWords(12.5), "twelve point five");
  assert.equal(numberWords(-5), "minus five");
});
test("cosine has safe dimensions, zero vector handling, and expected normalized scores", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 2]), 0);
  assert.equal(cosine([1], [1, 2]), 0);
});
test("hybrid names, tags, Arabic and exact numbers work without common question-word boosts", () => {
  assert.ok(exactBoost(memory, "What did Noor pay?") >= 0.76);
  assert.ok(exactBoost(memory, "Find 120") >= 0.76);
  assert.ok(exactBoost(memory, "١٢٠") >= 0.76);
  assert.ok(exactBoost({ ...memory, people: ["نور"] }, "ماذا دفعت نور؟") >= 0.76);
  assert.equal(exactBoost(memory, "Where is my spaceship?"), 0);
  assert.deepEqual(queryTokens("What is my memory about Noor?"), ["noor"]);
  assert.equal(exactBoost(memory, "What did Noora pay?"), 0);
});
test("structured weekly, monthly and explicit date/amount plans include complete aggregate scope", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const total = structuredIntent("How much did I spend this week?", now);
  assert.equal(total.active, true); assert.equal(total.total, true);
  assert.equal(total.from, "2026-09-28"); assert.equal(total.to, "2026-10-04");
  const ar = structuredIntent("كم صرفت هذا الشهر", now);
  assert.equal(ar.total, true); assert.equal(ar.from, "2026-09-01"); assert.equal(ar.to, "2026-09-30");
  const events = structuredIntent("What's coming next week?", now);
  assert.equal(events.upcoming, true); assert.equal(events.from, "2026-10-05"); assert.equal(events.to, "2026-10-11");
  const explicit = structuredIntent("Total over 25 from 2026-09-01 to 2026-09-30", now);
  assert.equal(explicit.minimumAmount, 25); assert.equal(explicit.from, "2026-09-01"); assert.equal(explicit.to, "2026-09-30");
  const namedMonth = structuredIntent("How much did I spend in July 2026?", now);
  assert.equal(namedMonth.from, "2026-07-01"); assert.equal(namedMonth.to, "2026-07-31");
});
test("dates reject impossible calendar days and retry delays grow exponentially with jitter cap", () => {
  assert.equal(validDateFilter("2026-02-30"), false);
  assert.equal(validDateFilter("2026-02-28"), true);
  assert.equal(validDateFilter("2026-09-30T10:00:00"), false);
  assert.equal(retryDelay(0, () => 0.5), 15000);
  assert.equal(retryDelay(1, () => 0.5), 30000);
  assert.ok(retryDelay(99, () => 0) <= 3600000);
});

test("relative dates use the browser's local day, local year, DST-safe weeks and Arabic this-week wording", () => {
  const now = new Date("2026-10-01T01:00:00Z");
  assert.equal(localCalendarDate(now, "America/Los_Angeles"), "2026-09-30");
  const today = structuredIntent("How much did I spend today?", now, "America/Los_Angeles");
  assert.equal(today.from, "2026-09-30"); assert.equal(today.to, "2026-09-30");
  const month = structuredIntent("How much did I spend this month?", now, "America/Los_Angeles");
  assert.equal(month.from, "2026-09-01"); assert.equal(month.to, "2026-09-30");
  const week = structuredIntent("ما المواعيد القادمة هذا الأسبوع؟", now, "Asia/Jerusalem");
  assert.equal(week.from, "2026-09-28"); assert.equal(week.to, "2026-10-04");
  const localYear = structuredIntent("How much did I spend this year?", new Date("2027-01-01T01:00:00Z"), "America/Los_Angeles");
  assert.equal(localYear.from, "2026-01-01");
  assert.equal(validTimezone("Unverified/Zone"), false);
  assert.equal(validTimezone("Asia/Jerusalem"), true);
});
test("count and quantity questions are not receipts unless financial context establishes spending", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const appointments = structuredIntent("كم موعد عندي هذا الأسبوع؟", now);
  assert.equal(appointments.total, false); assert.equal(appointments.upcoming, true);
  assert.equal(appointments.appointmentOnly, true);
  assert.equal(appointments.active, true);
  assert.equal(structuredIntent("How much time did I spend studying?", now).total, false);
  assert.equal(structuredIntent("How much time do I have this week?", now).total, false);
  assert.equal(structuredIntent("كم فكرة عندي؟", now).total, false);
  assert.equal(structuredIntent("كم صرفت هذا الشهر؟", now).total, true);
});
test("spending scope retains merchant/category qualifiers and strips date/report boilerplate only", () => {
  assert.deepEqual(financialQualifiers("How much did I spend on coffee this week?"), ["coffee"]);
  assert.deepEqual(financialQualifiers("How much did I spend at Acme on coffee from 2026-09-01 to 2026-09-30?"), ["acme", "coffee"]);
  assert.deepEqual(financialQualifiers("How much did I spend on rocket fuel today?"), ["rocket", "fuel"]);
  assert.deepEqual(financialQualifiers("كم صرفت عند أحمد على القهوة هذا الأسبوع؟"), ["احمد", "القهوة"]);
  assert.deepEqual(financialQualifiers("How much did I spend on 2026-09-30? Report every currency separately, including unknown currency."), []);
  assert.deepEqual(structuredIntent("How much did I spend on coffee today?").qualifiers, ["coffee"]);
});
test("all generated response validators strip private embeddings and durable job metadata", () => {
  const privateMemory = { ...memory, userId: "private", user_id: "private", embedding: [1, 2], embedding_version: 3, lease_until: "x" };
  const parsed = GetMemoryResponse.parse(privateMemory);
  assert.equal("embedding" in parsed, false); assert.equal("userId" in parsed, false);
  const related = SearchRelatedResponse.parse({ memories: [{ ...privateMemory, relevance: 0.9 }] });
  assert.equal(related.memories[0].relevance, 0.9);
  assert.equal("embedding" in related.memories[0], false);
  const answer = AskBrainResponse.parse({ answer: "Dinner", source_ids: [1], sources: [{ ...privateMemory, relevance: 0.9 }] });
  assert.equal(answer.sources[0].relevance, 0.9);
  assert.equal("lease_until" in answer.sources[0], false);
});