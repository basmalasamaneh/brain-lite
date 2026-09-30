import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiModel, generateGeminiContent, providerDiagnostic } from "./gemini-provider";

test("both extraction and Ask use the configured model", () => {
  assert.equal(geminiModel(), process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite");
});

test("provider diagnostics never contain raw messages or keys", () => {
  const key = "sensitive-secret";
  assert.deepEqual(providerDiagnostic({ status: 503, message: `https://example.test?key=${key} high demand` }),
    { status: 503, reason: "capacity" });
  assert.deepEqual(providerDiagnostic({ status: 404, message: "model no longer available to new users" }),
    { status: 404, reason: "model_retired" });
  assert.deepEqual(providerDiagnostic(new Error(key)), { status: null, reason: "unknown" });
  assert.deepEqual(providerDiagnostic({ status: "401", message: key }), { status: null, reason: "unknown" });
});

test("only transient provider errors retry once; request unchanged", async () => {
  const request = { model: "synthetic-model", contents: "synthetic" };
  const sleeps: number[] = [];
  let calls = 0;
  const response = await generateGeminiContent("test", request, async (ms) => { sleeps.push(ms); }, async (payload) => {
    assert.equal(payload, request);
    if (++calls === 1) throw { status: 503, message: "high demand" };
    return "ok";
  });
  assert.equal(response, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
  calls = 0;
  await assert.rejects(generateGeminiContent("test", request, async () => { throw Error("should not retry"); }, async () => {
    calls++;
    throw { status: 404, message: "no longer available" };
  }));
  assert.equal(calls, 1);
});