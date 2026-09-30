import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, memoriesTable, uploadsTable, usersTable } from "@workspace/db";
import { AskBrainBody, AskBrainResponse, DeleteBrainDataBody, DeleteBrainDataResponse, ExportBrainDataResponse } from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { activeCaptures, activeQuestions as activeUserQuestions, activeUploadRequests, deletingUsers } from "../lib/brain-state";
import rateLimit from "express-rate-limit";
import {
  generateGroundedAnswer, noDataAnswer, parseGroundedAnswer, prepareContext,
  type CompactMemory,
} from "../lib/brain-answer";

const router: IRouter = Router();
const storage = new ObjectStorageService();
let activeQuestions = 0;
const MAX_CONCURRENT_QUESTIONS = 4;
const askLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30,
  keyGenerator: (req) => req.user!.id, message: { error: "AI request limit reached. Retry later." } });

router.use("/brain", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Please sign in to access your personal data" });
    return;
  }
  next();
});

function serializeMemory(row: typeof memoriesTable.$inferSelect) {
  const { userId: _userId, ...memory } = row;
  return { ...memory, created_at: row.created_at.toISOString() };
}

router.post("/brain/ask", askLimiter, async (req, res): Promise<void> => {
  const parsed = AskBrainBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.question.trim()) {
    res.status(400).json({ error: "A valid question and language are required" });
    return;
  }
  if (deletingUsers.has(req.user!.id)) {
    res.status(409).json({ error: "Personal data deletion is in progress" });
    return;
  }
  if (activeQuestions >= MAX_CONCURRENT_QUESTIONS) {
    res.status(503).json({ error: "Too many questions in progress. Please retry shortly." });
    return;
  }
  activeQuestions++;
  activeUserQuestions.set(req.user!.id, (activeUserQuestions.get(req.user!.id) ?? 0) + 1);
  try {
    const { question, language } = parsed.data;
    // Deliberately exclude raw text, attachments, extra fields and other users.
    const compact = await db.select({
      id: memoriesTable.id, type: memoriesTable.type, title: memoriesTable.title,
      summary: memoriesTable.summary, date: memoriesTable.event_date,
      amount: memoriesTable.amount, currency: memoriesTable.currency,
      people: memoriesTable.people, tags: memoriesTable.tags,
    }).from(memoriesTable).where(eq(memoriesTable.userId, req.user!.id));
    if (!compact.length) {
      res.json(AskBrainResponse.parse({ answer: noDataAnswer(language), source_ids: [], sources: [] }));
      return;
    }
    let context: string;
    try {
      context = prepareContext(compact satisfies CompactMemory[]);
    } catch {
      res.status(413).json({ error: "Your memories exceed the question context limit. Nothing was omitted; please reduce or archive memories before asking." });
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Question answering is not configured. Set GEMINI_API_KEY." });
      return;
    }
    const text = await generateGroundedAnswer(question, language, context, apiKey);
    const result = parseGroundedAnswer(text, new Set(compact.map((row) => row.id)), language);
    const rows = result.source_ids.length
      ? await db.select().from(memoriesTable).where(and(
          eq(memoriesTable.userId, req.user!.id),
          inArray(memoriesTable.id, result.source_ids),
        ))
      : [];
    // A memory removed while Gemini was answering must not be cited.
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (result.source_ids.some((id) => !byId.has(id))) {
      res.status(503).json({ error: "Your memories changed while answering. Please retry." });
      return;
    }
    res.json(AskBrainResponse.parse({
      ...result,
      sources: result.source_ids.map((id) => serializeMemory(byId.get(id)!)),
    }));
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Grounded question failed");
    res.status(503).json({ error: "Unable to safely answer from your memories. Please retry later." });
  } finally {
    activeQuestions--;
    const remaining = (activeUserQuestions.get(req.user!.id) ?? 1) - 1;
    if (remaining) activeUserQuestions.set(req.user!.id, remaining);
    else activeUserQuestions.delete(req.user!.id);
  }
});

router.get("/brain/export", async (req, res): Promise<void> => {
  if (deletingUsers.has(req.user!.id)) {
    res.status(409).json({ error: "Personal data deletion is in progress" });
    return;
  }
  try {
    const userId = req.user!.id;
    const [[profile], memories, uploads] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, userId)),
      db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)),
      db.select().from(uploadsTable).where(eq(uploadsTable.userId, userId)),
    ]);
    if (!profile) { res.status(503).json({ error: "Profile unavailable" }); return; }
    const payload = ExportBrainDataResponse.parse({
      profile: {
        id: profile.id, email: profile.email, name: profile.name,
        language: profile.language, theme: profile.theme, onboardingCompleted: profile.onboardingCompleted,
        createdAt: profile.createdAt.toISOString(), updatedAt: profile.updatedAt.toISOString(),
      },
      memories: memories.map(serializeMemory),
      uploads: uploads.map(({ path, name, size, contentType }) => ({ path, name, size, contentType })),
    });
    res.setHeader("Content-Disposition", 'attachment; filename="brain-lite-data.json"');
    res.json(payload);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Personal data export failed");
    res.status(503).json({ error: "Unable to export personal data. Please retry." });
  }
});

router.delete("/brain/data", async (req, res): Promise<void> => {
  if (!DeleteBrainDataBody.safeParse(req.body).success) {
    res.status(400).json({ error: "Type DELETE to confirm deletion" });
    return;
  }
  const userId = req.user!.id;
  if (activeCaptures.has(userId) || activeUploadRequests.has(userId) || activeUserQuestions.has(userId) || deletingUsers.has(userId)) {
    res.status(409).json({ error: "A capture, upload request, or deletion is in progress. Please retry shortly." });
    return;
  }
  deletingUsers.add(userId);
  try {
    // Keep metadata until all remote files have been removed. A failed file remains
    // discoverable for a later retry; missing files are safe on repeat attempts.
    const uploads = await db.select({ path: uploadsTable.path }).from(uploadsTable)
      .where(eq(uploadsTable.userId, userId));
    for (const upload of uploads) {
      try {
        const file = await storage.getObjectEntityFile(upload.path);
        await file.delete({ ignoreNotFound: true });
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(memoriesTable).where(eq(memoriesTable.userId, userId));
      await tx.delete(uploadsTable).where(eq(uploadsTable.userId, userId));
    });
    res.json(DeleteBrainDataResponse.parse({
      deleted: true, scope: "Your memories and owned uploads/files were deleted. Your account and login remain active.",
    }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Personal data deletion partially failed");
    res.status(503).json({ error: "Deletion could not be completed. Some files may already be removed; your remaining records are retained for a safe retry." });
  } finally {
    deletingUsers.delete(userId);
  }
});

export default router;