import assert from "node:assert/strict";
import { after, test } from "node:test";
import sharp from "sharp";
import {
  attachmentBlock,
  extractMemory,
  extractMemoryWithDependencies,
  extractionPrompt,
  parseExtractionResponse,
  toGeminiRequest,
  type ExtractionTransport,
} from "./extraction";

const originalKey = process.env.GEMINI_API_KEY;
after(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

const valid = {
  type: "receipt", title: "Shop", summary: "Purchase", event_date: "2024-02-29",
  amount: 12.5, currency: "USD", people: ["Sam"], tags: ["shopping"], confidence: 80,
  extra: { store: "Shop", items: [{ name: "Coffee", price: 12.5 }] },
};
const deps = { apiKey: "test-only", sleep: async () => {} };

test("no key does not call the API", async () => {
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(await extractMemory({ rawText: "a note" }), { ok: false, reason: "not_configured" });
  let calls = 0;
  assert.deepEqual(await extractMemoryWithDependencies({ rawText: "" }, {
    transport: async () => { calls++; return { content: [] }; },
  }), { ok: false, reason: "not_configured" });
  assert.equal(calls, 0);
});

test("fences are stripped only when surrounding the entire response", () => {
  assert.deepEqual(parseExtractionResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``), valid);
  assert.equal(parseExtractionResponse(`intro\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``), null);
});

test("malformed response retries once and succeeds with unchanged request", async () => {
  let calls = 0;
  const transport: ExtractionTransport = async (request) => {
    calls++;
    assert.equal(request.model, process.env.GEMINI_MODEL || "gemini-3.1-flash-lite");
    assert.equal(request.max_tokens, 8192);
    assert.equal(request.messages[0].content[0].type, "text");
    return { content: [{ type: "text", text: calls === 1 ? "{bad" : JSON.stringify(valid) }] };
  };
  assert.deepEqual(await extractMemoryWithDependencies({ rawText: "Coffee" }, { ...deps, transport }), { ok: true, data: valid });
  assert.equal(calls, 2);
});

test("Gemini receives JSON mode and native inline image/PDF parts", () => {
  const request = toGeminiRequest({
    model: "gemini-3.8-flash", max_tokens: 8192, system: "Extract JSON only",
    messages: [{ role: "user", content: [
      { type: "text", text: "receipt" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aW1hZ2U=" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
    ] }],
  });
  assert.deepEqual(request.contents, [{ role: "user", parts: [
    { text: "receipt" },
    { inlineData: { mimeType: "image/jpeg", data: "aW1hZ2U=" } },
    { inlineData: { mimeType: "application/pdf", data: "cGRm" } },
  ] }]);
  assert.equal(request.config?.responseMimeType, "application/json");
  assert.equal(request.config?.systemInstruction, "Extract JSON only");
});

test("two invalid responses never cause a third API call", async () => {
  let calls = 0;
  const result = await extractMemoryWithDependencies({ rawText: "Coffee" }, {
    ...deps,
    transport: async () => { calls++; return { content: [{ type: "text", text: "{}" }] }; },
  });
  assert.deepEqual(result, { ok: false, reason: "invalid_response" });
  assert.equal(calls, 2);
});

test("non-transient transport errors are unavailable without a duplicate call", async () => {
  let calls = 0;
  assert.deepEqual(await extractMemoryWithDependencies({ rawText: "" }, {
    ...deps, transport: async () => { calls++; throw new Error("private error"); },
  }), { ok: false, reason: "unavailable" });
  assert.equal(calls, 1);
});

test("strict schema rejects coercion, unknown keys, invalid dates, and oversized extra", () => {
  const invalid = [
    { confidence: "80" }, { confidence: 100.1 }, { confidence: -1 }, { confidence: 101 },
    { amount: "12" }, { amount: -1 }, { event_date: "2023-02-29" },
    { event_date: "2024-04-31T10:00:00Z" }, { event_date: "2024-13-01" },
    { event_date: "2024-00-01" }, { event_date: "0999-12-31" },
    { event_date: "2024-02-29T24:00:00" }, { event_date: "2024-02-29T10:60:00" },
    { type: "bill" }, { people: Array(51).fill("x") }, { tags: ["x".repeat(101)] },
    { extra: { huge: "x".repeat(17_000) } }, { unexpected: true },
  ];
  for (const change of invalid) assert.equal(parseExtractionResponse(JSON.stringify({ ...valid, ...change })), null, JSON.stringify(Object.keys(change)));
  assert.equal(parseExtractionResponse(JSON.stringify({ ...valid, event_date: "2024-02-29T10:30:00+03:00", confidence: 79 }))?.confidence, 79);
  assert.equal(parseExtractionResponse(JSON.stringify({ ...valid, event_date: "1000-01-01" }))?.event_date, "1000-01-01");
  assert.equal(parseExtractionResponse(JSON.stringify({ ...valid, confidence: 80 }))?.confidence, 80);
});

test("appointment floating local datetime is preserved without an offset", async () => {
  const appointment = { ...valid, type: "appointment", event_date: "2024-02-29T10:30:00" };
  assert.equal(parseExtractionResponse(JSON.stringify(appointment))?.event_date, appointment.event_date);
  const outcome = await extractMemoryWithDependencies({ rawText: "Appointment on February 29 at 10:30" }, {
    ...deps,
    transport: async () => ({ content: [{ type: "text", text: JSON.stringify(appointment) }] }),
  });
  assert.equal(outcome.ok && outcome.data.event_date, appointment.event_date);
  assert.match(extractionPrompt({ rawText: "" }), /floating local time/);
});

test("language and verified timezone date context are in system prompt, user content remains data", () => {
  const prompt = extractionPrompt({ rawText: "موعد غدا", language: "en", timezone: "Asia/Riyadh" }, new Date("2024-03-01T23:00:00Z"));
  assert.match(prompt, /language of the actual source text\/attachment/);
  assert.match(prompt, /English.*ONLY a fallback/);
  assert.match(prompt, /Arabic source with English UI must produce Arabic text/);
  assert.match(prompt, /summary in 1-2 sentences/);
  assert.match(prompt, /Asia\/Riyadh/);
  assert.match(prompt, /2024-03-02/);
  assert.doesNotMatch(prompt, /موعد غدا/);
  assert.match(extractionPrompt({ rawText: "Tomorrow", timezone: "invalid-timezone" }), /No verified timezone supplied/);
});

test("PDF signature, base64 document block, invalid files and oversized bytes", async () => {
  const pdf = Buffer.from("%PDF-1.7\ncontent");
  assert.deepEqual(await attachmentBlock({ bytes: pdf, contentType: "application/pdf", name: "a.pdf" }), {
    type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
  });
  assert.equal(await attachmentBlock({ bytes: Buffer.from("not a pdf"), contentType: "application/pdf", name: "a.pdf" }), null);
  assert.equal(await attachmentBlock({ bytes: pdf, contentType: "application/zip", name: "a.zip" }), null);
  assert.equal(await attachmentBlock({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: "application/pdf", name: "x" }), null);
  assert.deepEqual(await extractMemoryWithDependencies({
    rawText: "", attachment: { bytes: Buffer.from("invalid"), contentType: "image/heic", name: "x.heic" },
  }, deps), { ok: false, reason: "unsupported_file" });
});

test("JPEG PNG WebP use compressed JPEG base64 and PDF stays a document in API request", async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: "#eeffcc" } }).png().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const jpg = await sharp(png).jpeg().toBuffer();
  for (const [mime, bytes] of [["image/png", png], ["image/webp", webp], ["image/jpeg", jpg]] as const) {
    const block = await attachmentBlock({ bytes, contentType: mime, name: "image" });
    assert.equal(block?.type, "image");
    if (block?.type === "image") {
      assert.equal(block.source.media_type, "image/jpeg");
      assert.equal(Buffer.from(block.source.data, "base64").subarray(0, 3).toString("hex"), "ffd8ff");
    }
  }
  const imageResult = await extractMemoryWithDependencies({
    rawText: "a photo", attachment: { bytes: png, contentType: "image/png", name: "photo.png" },
  }, { ...deps, transport: async (request) => {
    assert.equal(request.messages[0].content[1]?.type, "image");
    return { content: [{ type: "text", text: JSON.stringify(valid) }] };
  } });
  assert.equal(imageResult.ok, true);
  let calls = 0;
  const result = await extractMemoryWithDependencies({
    rawText: "invoice", attachment: { bytes: Buffer.from("%PDF-1.7\nbody"), contentType: "application/pdf", name: "a.pdf" },
  }, { ...deps, transport: async (request) => {
    calls++;
    assert.equal(request.messages[0].content[1]?.type, "document");
    return { content: [{ type: "text", text: JSON.stringify(valid) }] };
  } });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});