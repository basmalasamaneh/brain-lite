import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { cleanupReservedVoiceUpload, decodeAudio, MAX_VOICE_BYTES, parseTranscriptionResponse, parseVoiceResult, plainBody, transcodeMp3, validateAudioDuration, voiceBody } from "./voice-capture";

const wavHeader = Buffer.from("RIFF\x00\x00\x00\x00WAVE", "binary");
const body = { audio_base64: wavHeader.toString("base64"), mime_type: "audio/wav", language: "ar",
  timezone: "Asia/Jerusalem", keep_recording: false };

test("transcription preserves English and Arabic questions without extraction or answering", () => {
  assert.equal(parseTranscriptionResponse('{"transcript":"How much did I spend today?"}'), "How much did I spend today?");
  assert.equal(parseTranscriptionResponse('{"transcript":"  كم صرفت اليوم؟  "}'), "كم صرفت اليوم؟");
  assert.throws(() => parseTranscriptionResponse('{"transcript":""}'), { code: "no_speech" });
  assert.throws(() => parseTranscriptionResponse('{"transcript":"hello","items":[]}'), { code: "invalid_extraction" });
  assert.throws(() => parseTranscriptionResponse('not json'), { code: "invalid_extraction" });
});

test("strict voice input rejects missing audio, data URIs, unknown zones and MIME mismatch", () => {
  assert.equal(voiceBody.safeParse(body).success, true);
  for (const value of [
    { ...body, audio_base64: "" }, { ...body, audio_base64: "data:audio/wav;base64,AA==" },
    { ...body, mime_type: "application/pdf" }, { ...body, timezone: "unverified" },
    { ...body, userId: "somebody-else" },
  ]) assert.equal(voiceBody.safeParse(value).success, false);
  assert.throws(() => decodeAudio(body.audio_base64, "audio/ogg"), { code: "mime_mismatch" });
});

test("decoded audio is bounded at exactly 5 MiB, including base64 body overhead", () => {
  const valid = Buffer.alloc(MAX_VOICE_BYTES);
  wavHeader.copy(valid);
  assert.equal(decodeAudio(valid.toString("base64"), "audio/wav").length, MAX_VOICE_BYTES);
  const oversized = Buffer.concat([valid, Buffer.from([0])]);
  // Some 5 MiB + 1 payloads have the same encoded length; decoded check is authoritative.
  assert.equal(voiceBody.safeParse({ ...body, audio_base64: oversized.toString("base64") }).success, true);
  assert.throws(() => decodeAudio(oversized.toString("base64"), "audio/wav"), { code: "audio_too_large" });
});

test("invalid extraction preserves real recovered transcript but never saves invented items", () => {
  assert.throws(() => parseVoiceResult('{"transcript":"اتصل بطبيب الأسنان","items":[{"title":"fabrication"}]}'),
    { code: "invalid_extraction", transcript: "اتصل بطبيب الأسنان" });
  assert.throws(() => parseVoiceResult('{"transcript":"","items":[]}'), { code: "no_speech" });
  assert.throws(() => parseVoiceResult("no json"), { code: "invalid_extraction" });
  const item = { type: "task", title: "Call dentist", summary: "Call dentist", event_date: null,
    amount: null, currency: "", people: [], tags: [], confidence: 82 };
  const result = parseVoiceResult(JSON.stringify({ transcript: "Call dentist and buy a gift", items: [
    { ...item, transcript: "Call dentist" }, { ...item, title: "Buy gift", transcript: "buy a gift" },
  ] }));
  assert.equal(result.items.length, 2);
  assert.equal(parseVoiceResult(JSON.stringify({ transcript: "Call dentist", ...item })).items.length, 1);
});

test("Gemini nullable or absent semantic fields normalize safely, while wrong types and unknown fields fail", () => {
  const base = { type: "task", title: "Call the dentist", confidence: 75 };
  const nullCurrency = parseVoiceResult(JSON.stringify({
    transcript: "Call the dentist tomorrow", items: [{ ...base, summary: "Call the dentist", event_date: null,
      amount: null, currency: null, people: [], tags: [] }],
  }));
  assert.equal(nullCurrency.items[0].currency, "");
  const missing = parseVoiceResult(JSON.stringify({ transcript: "Call dentist", items: [base] }));
  assert.deepEqual(missing.items[0], {
    ...base, summary: "", event_date: null, amount: null, currency: "", people: [], tags: [],
  });
  for (const bad of [
    { ...base, currency: 0 },
    { ...base, amount: "30" },
    { ...base, people: "dentist" },
    { ...base, invented: "hidden field" },
  ]) assert.throws(() => parseVoiceResult(JSON.stringify({ transcript: "Call dentist", items: [bad] })),
    { code: "invalid_extraction", transcript: "Call dentist" });
});

test("plain note requires explicit nonblank text and cannot accept someone else's ownership", () => {
  assert.equal(plainBody.safeParse({ transcript: "مرحبا", language: "ar" }).success, true);
  assert.equal(plainBody.safeParse({ transcript: "   ", language: "en" }).success, false);
  assert.equal(plainBody.safeParse({ transcript: "hi", language: "en", userId: "outsider" }).success, false);
});

test("failed or partial recording cleanup never drops owned upload metadata", async () => {
  let metadataPresent = true;
  let remotePresent = true;
  let attempts = 0;
  const removeMetadata = async () => { metadataPresent = false; };
  const failedPutCleanup = await cleanupReservedVoiceUpload(
    async () => { attempts++; throw Error("remote deletion unavailable after timed-out PUT"); },
    removeMetadata,
  );
  assert.equal(failedPutCleanup, false);
  assert.equal(attempts, 1);
  assert.equal(metadataPresent, true);
  assert.equal(remotePresent, true);
  // PUT outcome unknown: deletion can race a late remote commit, so retain
  // metadata even when the immediate deletion completes successfully.
  assert.equal(await cleanupReservedVoiceUpload(async () => { remotePresent = false; }), true);
  assert.equal(metadataPresent, true);
  const failedMetadataCleanup = await cleanupReservedVoiceUpload(
    async () => { remotePresent = false; },
    async () => { throw Error("database temporarily unavailable"); },
  );
  assert.equal(failedMetadataCleanup, false);
  assert.equal(metadataPresent, true);
  const successfulRetry = await cleanupReservedVoiceUpload(
    async () => { remotePresent = false; },
    removeMetadata,
  );
  assert.equal(successfulRetry, true);
  assert.equal(metadataPresent, false);
});

test("ffprobe validates real streamed WebM even without container duration and rejects >120s", async () => {
  for (const seconds of [1, 121]) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      `anullsrc=r=8000:cl=mono:d=${seconds}`, "-c:a", "libopus", "-b:a", "12k", "-f", "webm", "pipe:1"],
    { maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0);
    assert.equal(decodeAudio(result.stdout.toString("base64"), "audio/webm").length, result.stdout.length);
    if (seconds === 1) {
      await validateAudioDuration(result.stdout);
      const mp3 = await transcodeMp3(result.stdout);
      assert.equal(decodeAudio(mp3.toString("base64"), "audio/mpeg").length, mp3.length);
      await validateAudioDuration(mp3);
    }
    else await assert.rejects(validateAudioDuration(result.stdout), { code: "audio_too_long" });
  }
  await assert.rejects(validateAudioDuration(wavHeader), { code: "invalid_audio" });
});