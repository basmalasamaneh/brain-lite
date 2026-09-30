import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { db, memoriesTable, uploadsTable } from "@workspace/db";
import { GetMemoryResponse, TranscribeVoiceResponse } from "@workspace/api-zod";
import { activeCaptures, deletingUsers } from "../lib/brain-state";
import { validEventDate } from "../lib/calendar";
import { ObjectStorageService } from "../lib/objectStorage";
import { cleanupReservedVoiceUpload, decodeAudio, MAX_VOICE_BYTES, plainBody, transcribeAudio, understandVoice, validateAudioDuration, VoiceError, voiceBody } from "../lib/voice-capture";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const voiceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 30, keyGenerator: (req) => req.user!.id,
  message: { error: "Voice processing limit reached. Please retry later.", code: "ai_limit" },
});
function serialize(row: typeof memoriesTable.$inferSelect) {
  const { userId: _userId, ...memory } = row;
  return GetMemoryResponse.parse({ ...memory, created_at: row.created_at.toISOString() });
}

router.post("/voice/transcribe", voiceLimiter, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  if (deletingUsers.has(userId)) { res.status(409).json({ error: "Personal data deletion is in progress.", code: "deleting" }); return; }
  if (activeCaptures.has(userId)) { res.status(429).json({ error: "Voice processing is already in progress.", code: "busy" }); return; }
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON audio data.", code: "invalid_input" }); return; }
  const parsed = voiceBody.safeParse(req.body);
  if (!parsed.success || parsed.data.keep_recording) {
    const oversized = typeof req.body?.audio_base64 === "string" && req.body.audio_base64.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4;
    res.status(oversized ? 413 : 400).json({ error: oversized ? "Recording must be 5 MB or smaller." : "Invalid recording. Transcription requires keep_recording false.", code: oversized ? "audio_too_large" : "invalid_input" }); return;
  }
  activeCaptures.add(userId);
  try {
    const { audio_base64, mime_type, language } = parsed.data;
    const bytes = decodeAudio(audio_base64, mime_type);
    await validateAudioDuration(bytes);
    const transcript = await transcribeAudio(bytes, mime_type, language);
    // No storage service, upload reservation, INSERT, or memory creation.
    res.json(TranscribeVoiceResponse.parse({ transcript }));
  } catch (error) {
    if (error instanceof VoiceError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else {
      req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Voice transcription unavailable");
      res.status(503).json({ error: "Voice transcription is unavailable right now.", code: "unavailable" });
    }
  } finally { activeCaptures.delete(userId); }
});

router.post("/capture/voice", voiceLimiter, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  if (deletingUsers.has(userId)) { res.status(409).json({ error: "Personal data deletion is in progress.", code: "deleting" }); return; }
  if (activeCaptures.has(userId)) { res.status(429).json({ error: "A capture is already processing. Please wait.", code: "busy" }); return; }
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON audio data.", code: "invalid_input" }); return; }
  const parsed = voiceBody.safeParse(req.body);
  if (!parsed.success) {
    const oversized = typeof req.body?.audio_base64 === "string" && req.body.audio_base64.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4;
    res.status(oversized ? 413 : 400).json({ error: oversized ? "Recording must be 5 MB or smaller." : "Invalid recording or audio details.", code: oversized ? "audio_too_large" : "invalid_input" }); return;
  }
  activeCaptures.add(userId);
  let transcript: string | undefined;
  let objectPath: string | undefined;
  let reserved = false;
  let uploadConfirmed = false;
  let committed = false;
  try {
    const { audio_base64, mime_type, language, timezone, keep_recording } = parsed.data;
    const bytes = decodeAudio(audio_base64, mime_type);
    await validateAudioDuration(bytes);
    const result = await understandVoice(bytes, mime_type, language, timezone);
    transcript = result.transcript;
    if (result.items.some((item) => item.event_date && !validEventDate(item.event_date))) {
      throw new VoiceError(503, "invalid_extraction", "We heard your words but couldn't organize them. You can save the transcript as a plain note.", transcript);
    }
    if (keep_recording) {
      const uploadURL = await storage.getObjectEntityUploadURL(userId);
      objectPath = storage.normalizeObjectEntityPath(uploadURL);
      if (!objectPath.startsWith(`/objects/uploads/${userId}/`)) throw new Error("Invalid private recording path");
      // Reserve ownership BEFORE starting PUT. A timed-out/failed PUT may have
      // completed remotely; keep this row until deletion is actually confirmed.
      await db.insert(uploadsTable).values({
        path: objectPath, userId, name: "Voice recording", size: bytes.length,
        contentType: mime_type.split(";")[0],
      });
      reserved = true;
      const response = await fetch(uploadURL, {
        method: "PUT", headers: { "Content-Type": mime_type.split(";")[0] },
        body: bytes, signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Unable to keep recording");
      uploadConfirmed = true;
    }
    const rows = await db.transaction(async (tx) => {
      return tx.insert(memoriesTable).values(result.items.map((item) => {
        const specific = item.transcript?.trim();
        // Keep each item's exact spoken words only if present verbatim in the complete transcript.
        const raw = specific && transcript!.includes(specific) ? specific : transcript!;
        return {
          userId, type: item.type, title: item.title, summary: item.summary,
          event_date: item.event_date, amount: item.amount, currency: item.currency,
          people: item.people, tags: item.tags, confidence: item.confidence,
          transcript: raw, raw_text: raw, file_path: objectPath ?? null,
          ...(objectPath ? { extra: { attachment_kind: "audio", audio_mime_type: mime_type.split(";")[0] } } : {}),
          status: "needs_review" as const, extraction_status: "extracted" as const,
        };
      })).returning();
    });
    committed = true;
    res.status(201).json({ transcript, memories: rows.map(serialize) });
  } catch (error) {
    if (reserved && objectPath && !committed) {
      const path = objectPath;
      const cleaned = await cleanupReservedVoiceUpload(
        async () => { await (await storage.getObjectEntityFile(path)).delete(); },
        uploadConfirmed
          ? async () => { await db.delete(uploadsTable).where(and(eq(uploadsTable.path, path), eq(uploadsTable.userId, userId))); }
          : undefined,
      );
      if (!cleaned) req.log.error("Unable to roll back voice recording; owned upload metadata retained for later cleanup");
      // Even a successful deletion after a timed-out PUT might precede a late
      // remote commit. Preserve the row for later account/data cleanup.
    }
    if (error instanceof VoiceError) {
      res.status(error.status).json({ error: error.message, code: error.code, ...(error.transcript ? { transcript: error.transcript } : {}) });
    } else {
      req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Voice capture failed");
      res.status(503).json({ error: transcript
        ? "We heard your words but couldn't save them. Please try again or save the transcript as a plain note."
        : "Voice processing is unavailable right now. Please try again.", code: "unavailable", ...(transcript ? { transcript } : {}) });
    }
  } finally {
    activeCaptures.delete(userId);
  }
});

router.post("/capture/voice/plain", async (req, res): Promise<void> => {
  const userId = req.user!.id;
  if (deletingUsers.has(userId)) { res.status(409).json({ error: "Personal data deletion is in progress." }); return; }
  const parsed = plainBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter the words you want to save as a note." }); return; }
  if (activeCaptures.has(userId)) { res.status(409).json({ error: "A capture is processing. Please wait." }); return; }
  activeCaptures.add(userId);
  try {
    const transcript = parsed.data.transcript.trim();
    const [row] = await db.insert(memoriesTable).values({
      userId, title: transcript.split("\n")[0].slice(0, 100), type: "note",
      raw_text: transcript, transcript, confidence: 0, status: "needs_review",
      extraction_status: "fallback", extraction_error: "unavailable",
    }).returning();
    res.status(201).json(serialize(row));
  } catch {
    res.status(503).json({ error: "Unable to save your note. Please try again." });
  } finally { activeCaptures.delete(userId); }
});
export default router;