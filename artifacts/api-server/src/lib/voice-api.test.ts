import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import supertest from "supertest";

// Opt-in integration test: writes only disposable synthetic accounts and deletes
// them in finally. Never reads, edits or deletes existing user accounts.
test("authenticated voice API rejects bad inputs and keeps plaintext notes private", {
  skip: process.env.VOICE_API_TEST !== "1" ? "Set VOICE_API_TEST=1 on a disposable development database" : undefined,
}, async () => {
  const { default: app } = await import("../app");
  const first = supertest.agent(app), second = supertest.agent(app);
  const password = `Voice-Test-${randomUUID()}`;
  const email1 = `voice-test-${randomUUID()}@example.invalid`;
  const email2 = `voice-test-${randomUUID()}@example.invalid`;
  const signup = (email: string) => ({ email, password, name: "Synthetic voice test", language: "en", theme: "system" });
  const one = await first.post("/api/auth/signup").send(signup(email1));
  assert.equal(one.status, 201);
  try {
    const two = await second.post("/api/auth/signup").send(signup(email2));
    assert.equal(two.status, 201);
    try {
      const anon = await supertest(app).post("/api/capture/voice/plain").send({ transcript: "test", language: "en" });
      assert.equal(anon.status, 401);
      const bad = await first.post("/api/capture/voice").send({
        audio_base64: "AA==", mime_type: "audio/wav", timezone: "UTC", language: "en",
      });
      assert.equal(bad.status, 400);
      const raw = Buffer.alloc(5 * 1024 * 1024);
      Buffer.from("RIFF\x00\x00\x00\x00WAVE", "binary").copy(raw);
      const bounded = await first.post("/api/capture/voice").send({
        audio_base64: raw.toString("base64"), mime_type: "audio/wav", timezone: "UTC",
        language: "en", keep_recording: false,
      });
      // The large JSON parser accepted this exactly 5 MiB request; ffprobe
      // subsequently rejects synthetic header-only bytes without calling AI.
      assert.equal(bounded.status, 422);
      const oversized = await first.post("/api/capture/voice").send({
        audio_base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
        mime_type: "audio/wav", timezone: "UTC", language: "en",
      });
      assert.equal(oversized.status, 413);
      const plain = await first.post("/api/capture/voice/plain").send({ transcript: "Buy bread", language: "en" });
      assert.equal(plain.status, 201);
      assert.equal(plain.body.transcript, "Buy bread");
      assert.equal(plain.body.file_path, null);
      assert.equal(plain.body.confidence, 0);
      const outsider = await second.get(`/api/memories/${plain.body.id}`);
      assert.equal(outsider.status, 404);
      const edit = await first.patch(`/api/memories/${plain.body.id}`).send({ transcript: "Buy fresh bread" });
      assert.equal(edit.status, 200);
      assert.equal(edit.body.transcript, "Buy fresh bread");
      const exported = await first.get("/api/brain/export");
      assert.equal(exported.status, 200);
      assert.equal(exported.body.memories.find((m: { id: number }) => m.id === plain.body.id)?.transcript, "Buy fresh bread");
    } finally {
      const deleted = await second.delete("/api/auth/account").send({ confirmation: "DELETE", password });
      assert.equal(deleted.status, 204);
    }
  } finally {
    const deleted = await first.delete("/api/auth/account").send({ confirmation: "DELETE", password });
    assert.equal(deleted.status, 204);
  }
});

// Explicit opt-in: calls the real Gemini provider and private object storage,
// and uses bundled synthetic speech, never a user's recordings.
test("live English/Arabic speech creates isolated multi-item memories across browser audio formats", {
  skip: process.env.VOICE_LIVE_TEST !== "1" ? "Set VOICE_LIVE_TEST=1 with provider and private storage on development" : undefined,
}, async () => {
  const { default: app } = await import("../app");
  const { db, uploadsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const { ObjectStorageService, ObjectNotFoundError } = await import("./objectStorage");
  const first = supertest.agent(app), second = supertest.agent(app);
  const password = `Voice-Live-Test-${randomUUID()}`;
  const email1 = `voice-live-${randomUUID()}@example.invalid`;
  const email2 = `voice-live-${randomUUID()}@example.invalid`;
  const signup = (email: string) => ({ email, password, name: "Synthetic voice test", language: "en", theme: "system" });
  const english = readFileSync(new URL("../../../../attached_assets/test-speech-en.mp3", import.meta.url));
  const arabic = readFileSync(new URL("../../../../attached_assets/test-speech-ar.mp3", import.meta.url));
  const local = new Intl.DateTimeFormat("en", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (name: string) => Number(local.find((piece) => piece.type === name)?.value);
  const localMidnight = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const tomorrow = new Date(localMidnight.getTime() + 86_400_000).toISOString().slice(0, 10);
  const daysToSunday = (7 - localMidnight.getUTCDay()) % 7 || 7;
  const nextSunday = new Date(localMidnight.getTime() + daysToSunday * 86_400_000).toISOString().slice(0, 10);
  const convert = (bytes: Buffer, args: string[]) => {
    const output = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", ...args, "pipe:1"],
      { input: bytes, maxBuffer: 5 * 1024 * 1024 });
    assert.equal(output.status, 0, "Synthetic format conversion must succeed");
    return output.stdout;
  };
  const webm = convert(english, ["-c:a", "libopus", "-f", "webm"]);
  const mp4 = convert(arabic, ["-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4"]);
  const firstSignup = await first.post("/api/auth/signup").send(signup(email1));
  assert.equal(firstSignup.status, 201);
  const firstId: string = firstSignup.body.user.id;
  let filePath: string | undefined;
  try {
    const secondSignup = await second.post("/api/auth/signup").send(signup(email2));
    assert.equal(secondSignup.status, 201);
    const secondId: string = secondSignup.body.user.id;
    try {
      const capture = (agent: typeof first, audio: Buffer, mime_type: string, language: "en" | "ar", keep_recording?: boolean) =>
        agent.post("/api/capture/voice").send({
          audio_base64: audio.toString("base64"), mime_type, language, timezone: "Asia/Hebron",
          ...(keep_recording === undefined ? {} : { keep_recording }),
        });
      const en = await capture(first, webm, "audio/webm", "en");
      assert.equal(en.status, 201, `English webm failed: ${en.body.code ?? en.status}`);
      const ar = await capture(second, mp4, "audio/mp4", "ar");
      assert.equal(ar.status, 201, `Arabic mp4 failed: ${ar.body.code ?? ar.status}`);
      for (const [response, lang] of [[en, "en"], [ar, "ar"]] as const) {
        assert.equal(response.body.memories.length, 2);
        assert.ok(response.body.transcript.length > 10);
        assert.ok(lang === "ar" ? /[\u0600-\u06ff]/.test(response.body.transcript) : /[a-z]/i.test(response.body.transcript));
        assert.deepEqual(response.body.memories.map((m: { event_date: string }) => m.event_date).sort(),
          [tomorrow, nextSunday].sort());
        for (const memory of response.body.memories) {
          assert.equal(memory.type, "task", "Calling a dentist is a task, not a booked appointment");
          assert.equal(memory.file_path, null, "Default is never retain audio");
          assert.ok(memory.transcript);
        }
      }
      assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, firstId))).length, 0);
      assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, secondId))).length, 0);
      assert.equal((await second.get(`/api/memories/${en.body.memories[0].id}`)).status, 404);
      assert.equal((await first.get(`/api/memories/${ar.body.memories[0].id}`)).status, 404);

      const kept = await capture(first, english, "audio/mpeg", "en", true);
      assert.equal(kept.status, 201, `Keep recording failed: ${kept.body.code ?? kept.status}`);
      assert.equal(kept.body.memories.length, 2);
      filePath = kept.body.memories[0].file_path;
      assert.ok(filePath?.startsWith(`/objects/uploads/${firstId}/`));
      for (const memory of kept.body.memories) {
        assert.equal(memory.file_path, filePath);
        assert.equal(memory.extra.attachment_kind, "audio");
        assert.equal(memory.extra.audio_mime_type, "audio/mpeg");
      }
      const owned = await first.get(`/api/storage${filePath}`).buffer(true);
      assert.equal(owned.status, 200);
      assert.match(owned.headers["content-type"], /^audio\/mpeg/);
      assert.equal((await second.get(`/api/storage${filePath}`)).status, 404);
      assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, firstId))).length, 1);
      assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, secondId))).length, 0);
    } finally {
      const deleted = await second.delete("/api/auth/account").send({ confirmation: "DELETE", password });
      assert.equal(deleted.status, 204);
      assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, secondId))).length, 0);
    }
  } finally {
    const deleted = await first.delete("/api/auth/account").send({ confirmation: "DELETE", password });
    assert.equal(deleted.status, 204);
    assert.equal((await db.select().from(uploadsTable).where(eq(uploadsTable.userId, firstId))).length, 0);
    if (filePath) await assert.rejects(new ObjectStorageService().getObjectEntityFile(filePath), ObjectNotFoundError);
  }
});