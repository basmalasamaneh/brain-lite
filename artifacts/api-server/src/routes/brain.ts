import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, memoriesTable, uploadsTable, usersTable, spacesTable } from "@workspace/db";
import { AskBrainBody, AskBrainResponse, DeleteBrainDataBody, DeleteBrainDataResponse, ExportBrainDataResponse } from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { activeCaptures, activeQuestions as activeUserQuestions, activeUploadRequests, deletingUsers } from "../lib/brain-state";
import rateLimit from "express-rate-limit";
import { publicMemory, retrieveForQuestion } from "../lib/semantic-search";
import { validTimezone } from "../lib/semantic-utils";
import { confirmedOneHop } from "../lib/connections";
import { ConnectionError } from "../lib/connections";
import { requireSpace, serializeSpace } from "../lib/spaces";
import { spaceIdBody } from "../lib/spaces-utils";
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
  const parsed = AskBrainBody.extend({ space_id: spaceIdBody }).safeParse(req.body);
  if (!parsed.success || !parsed.data.question.trim() || !validTimezone(parsed.data.timezone ?? "UTC")) {
    res.status(400).json({ error: "A valid question and language are required" });
    return;
  }
  if (deletingUsers.has(req.user!.id)) {
    res.status(409).json({ error: "Personal data deletion is in progress" });
    return;
  }
  if (parsed.data.space_id) {
    try { await requireSpace(req.user!.id, parsed.data.space_id); }
    catch (error) {
      if (error instanceof ConnectionError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  }
  if (activeQuestions >= MAX_CONCURRENT_QUESTIONS) {
    res.status(503).json({ error: "Too many questions in progress. Please retry shortly." });
    return;
  }
  activeQuestions++;
  activeUserQuestions.set(req.user!.id, (activeUserQuestions.get(req.user!.id) ?? 0) + 1);
  try {
    const { question, language, timezone = "UTC", space_id } = parsed.data;
    const retrieved = await retrieveForQuestion(req.user!.id, question, timezone, space_id);
    const aggregate = retrieved.aggregate;
    const connected = await confirmedOneHop(req.user!.id, retrieved.related.map(({ memory }) => memory.id));
    const related = [...retrieved.related, ...connected.map((memory) => ({ memory, relevance: 0 }))];
    const compact = related.map(({ memory: row }) => ({
      id: row.id, type: row.type, title: row.title, summary: row.summary,
      date: row.event_date, amount: row.amount, currency: row.currency,
      people: row.people, tags: row.tags,
      // Only retrieved text is supplied. No attachments, vectors or job metadata.
      text: row.raw_text.slice(0, 16000), transcript: row.transcript?.slice(0, 16000),
    }));
    if (!compact.length) {
      res.json(AskBrainResponse.parse({ answer: noDataAnswer(language), source_ids: [], sources: [] }));
      return;
    }
    let context: string;
    try {
      const memoriesContext = prepareContext(compact satisfies CompactMemory[]);
      context = aggregate ? JSON.stringify({ records: JSON.parse(memoriesContext), structured_sql: aggregate }) : memoriesContext;
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
      sources: result.source_ids.map((id) => ({ ...publicMemory(byId.get(id)!),
        relevance: related.find(({ memory }) => memory.id === id)?.relevance })),
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
    const [[profile], memories, uploads, spaces, memberships, creationSuggestions, hiddenProfileItems] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, userId)),
      db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)),
      db.select().from(uploadsTable).where(eq(uploadsTable.userId, userId)),
      db.select().from(spacesTable).where(eq(spacesTable.userId, userId)),
      pool.query("SELECT space_id,memory_id,source,status,reason,confidence FROM space_memories WHERE user_id=$1", [userId]),
      pool.query("SELECT id,kind,name,reason,status,space_id FROM space_creation_suggestions WHERE user_id=$1", [userId]),
      pool.query("SELECT space_id,item_id FROM space_profile_hidden WHERE user_id=$1", [userId]),
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
    res.json({ ...payload, spaces: spaces.map(serializeSpace), space_memories: memberships.rows,
      space_suggestions: creationSuggestions.rows, space_profile_hidden: hiddenProfileItems.rows });
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
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId},768006))`);
      await tx.execute(sql`DELETE FROM push_subscriptions WHERE user_id=${userId}`);
      await tx.execute(sql`DELETE FROM reminders WHERE user_id=${userId}`);
      await tx.execute(sql`DELETE FROM reminder_recompute_jobs WHERE user_id=${userId}`);
      await tx.execute(sql`DELETE FROM notifications WHERE user_id=${userId}`);
      await tx.execute(sql`DELETE FROM notification_daily_ledger WHERE user_id=${userId}`);
      await tx.execute(sql`DELETE FROM notification_suggestion_claims WHERE user_id=${userId}`);
      await tx.delete(spacesTable).where(eq(spacesTable.userId, userId));
      await tx.execute(sql`DELETE FROM space_creation_suggestions WHERE user_id=${userId}`);
      await tx.delete(memoriesTable).where(eq(memoriesTable.userId, userId));
      await tx.delete(uploadsTable).where(eq(uploadsTable.userId, userId));
    });
    res.json(DeleteBrainDataResponse.parse({
      deleted: true, scope: "Your memories, Spaces, suggestions, profiles, owned uploads/files, push subscriptions, reminders and notifications were deleted. Your account and login remain active.",
    }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Personal data deletion partially failed");
    res.status(503).json({ error: "Deletion could not be completed. Some files may already be removed; your remaining records are retained for a safe retry." });
  } finally {
    deletingUsers.delete(userId);
  }
});

export default router;