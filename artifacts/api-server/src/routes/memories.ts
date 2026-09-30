import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, memoriesTable, uploadsTable } from "@workspace/db";
import {
  CreateMemoryBody, UpdateMemoryBody, GetMemoryParams,
  ListMemoriesQueryParams, ListMemoriesResponse, GetMemoryResponse,
  GetMemoryStatsResponse,
} from "@workspace/api-zod";
import { extractMemory } from "../lib/extraction";
import { CaptureFileError, MAX_CAPTURE_FILE_BYTES, readCaptureFile } from "../lib/capture-file";
import { createCalendarEvent, validEventDate } from "../lib/calendar";
import { activeCaptures, deletingUsers } from "../lib/brain-state";
import rateLimit from "express-rate-limit";
import { validDateFilter } from "../lib/semantic-utils";

const router: IRouter = Router();
const captureLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30,
  keyGenerator: (req) => req.user!.id, message: { error: "AI request limit reached. Retry later." } });

// Personal data must never be cached by an intermediary.
router.use("/memories", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (_req.user && deletingUsers.has(_req.user.id) && !["GET", "HEAD"].includes(_req.method)) {
    res.status(409).json({ error: "Personal data deletion is in progress. Please retry shortly." });
    return;
  }
  next();
});

router.get("/memories/stats", async (req, res): Promise<void> => {
  const scope = eq(memoriesTable.userId, req.user!.id);
  const [stats] = await db.select({
    total: sql<number>`count(*)::int`,
    needs_review: sql<number>`count(*) filter (where ${memoriesTable.status} = 'needs_review')::int`,
    confirmed: sql<number>`count(*) filter (where ${memoriesTable.status} = 'confirmed')::int`,
  }).from(memoriesTable).where(scope);
  res.json(GetMemoryStatsResponse.parse(stats));
});

router.get("/memories", async (req, res): Promise<void> => {
  const parsed = ListMemoriesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid filters" }); return; }
  const scope = eq(memoriesTable.userId, req.user!.id);
  const { type, search, status, date_from, date_to } = parsed.data;
  if (!validDateFilter(date_from) || !validDateFilter(date_to) || date_from && date_to && date_from > date_to) {
    res.status(400).json({ error: "Invalid date filters" }); return;
  }
  const rows = await db.select().from(memoriesTable).where(and(
    scope,
    type && type !== "all" ? eq(memoriesTable.type, type as typeof memoriesTable.$inferSelect.type) : undefined,
    status ? eq(memoriesTable.status, status) : undefined,
    date_from ? sql`left(${memoriesTable.event_date},10)>=${date_from}` : undefined,
    date_to ? sql`left(${memoriesTable.event_date},10)<=${date_to}` : undefined,
    search ? or(ilike(memoriesTable.title, `%${search.slice(0, 200)}%`), ilike(memoriesTable.raw_text, `%${search.slice(0, 200)}%`)) : undefined,
  )).orderBy(desc(memoriesTable.created_at));
  res.json(ListMemoriesResponse.parse(rows.map(serialize)));
});

function serialize(row: typeof memoriesTable.$inferSelect) {
  const { userId: _userId, ...memory } = row;
  return { ...memory, created_at: row.created_at.toISOString() };
}

router.get("/memories/:id/calendar", async (req, res): Promise<void> => {
  const parsed = GetMemoryParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  const [row] = await db.select().from(memoriesTable).where(and(
    eq(memoriesTable.id, parsed.data.id),
    eq(memoriesTable.userId, req.user!.id),
  ));
  if (!row) { res.status(404).json({ error: "Memory not found" }); return; }
  if (row.type !== "appointment" || !row.event_date || !validEventDate(row.event_date)) {
    res.status(400).json({ error: "This memory is not an appointment with a valid date" }); return;
  }
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="brain-lite-${row.id}.ics"`);
  res.send(createCalendarEvent(row));
});

router.get("/memories/:id", async (req, res): Promise<void> => {
  const parsed = GetMemoryParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  const [row] = await db.select().from(memoriesTable).where(and(
    eq(memoriesTable.id, parsed.data.id),
    eq(memoriesTable.userId, req.user!.id),
  ));
  if (!row) { res.status(404).json({ error: "Memory not found" }); return; }
  res.json(GetMemoryResponse.parse(serialize(row)));
});

router.delete("/memories/samples", async (req, res): Promise<void> => {
  await db.delete(memoriesTable).where(and(eq(memoriesTable.userId, req.user!.id), eq(memoriesTable.is_sample, true)));
  res.sendStatus(204);
});

router.post("/memories", captureLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to save memories" }); return; }
  const parsed = CreateMemoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid capture" }); return; }
  const data = parsed.data;
  if (!data.raw_text.trim() && !data.file_path) {
    res.status(400).json({ error: "Add some text or attach a file" }); return;
  }
  const userId = req.user.id;
  if (activeCaptures.has(userId)) {
    res.status(429).json({ error: "A capture is already processing. Please wait." }); return;
  }
  activeCaptures.add(userId);
  try {
    let attachment: { bytes: Buffer; name: string; contentType: string } | undefined;
    if (data.file_path) {
      const [upload] = await db.select().from(uploadsTable).where(and(
        eq(uploadsTable.path, data.file_path), eq(uploadsTable.userId, userId),
      ));
      if (!upload) { res.status(400).json({ error: "Invalid attachment" }); return; }
      if (upload.size > MAX_CAPTURE_FILE_BYTES) {
        res.status(413).json({ error: "Files must be 10 MB or smaller" }); return;
      }
      // Ownership is checked before reading bytes; never fetch a URL supplied by the client.
      attachment = { bytes: await readCaptureFile(upload.path), name: upload.name, contentType: upload.contentType };
    }
    const extracted = await extractMemory({
      rawText: data.raw_text, title: data.title,
      language: data.language, timezone: data.timezone, attachment,
    }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
    if (!extracted.ok) req.log.warn({ reason: extracted.reason }, "Capture saved without AI extraction");
    const fallbackTitle = data.title?.trim() || data.raw_text.trim().split("\n")[0].slice(0, 100) ||
      attachment?.name || (data.language === "ar" ? "مرفق بدون عنوان" : "Untitled attachment");
    const [row] = await db.insert(memoriesTable).values({
      userId,
      title: fallbackTitle,
      type: "note", status: "needs_review", confidence: 0,
      ...(extracted.ok ? {
        ...extracted.data,
        status: extracted.data.confidence >= 80 ? "confirmed" as const : "needs_review" as const,
      } : {}),
      raw_text: data.raw_text,
      file_path: data.file_path || null,
      extraction_status: extracted.ok ? "extracted" : "fallback",
      extraction_error: extracted.ok ? null : extracted.reason,
    }).returning();
    res.status(201).json(GetMemoryResponse.parse(serialize(row)));
  } catch (error) {
    if (error instanceof CaptureFileError) {
      res.status(error.status).json({ error: error.message }); return;
    }
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Unable to save capture");
    res.status(500).json({ error: "Unable to save your memory. Please try again." });
  } finally {
    activeCaptures.delete(userId);
  }
});

router.patch("/memories/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to edit memories" }); return; }
  const params = GetMemoryParams.safeParse(req.params);
  const parsed = UpdateMemoryBody.safeParse(req.body);
  if (!params.success || !parsed.success || (parsed.data.title !== undefined && !parsed.data.title.trim())) {
    res.status(400).json({ error: "Invalid memory data" }); return;
  }
  if (parsed.data.event_date && !validEventDate(parsed.data.event_date)) {
    res.status(400).json({ error: "Invalid event date" }); return;
  }
  if (parsed.data.extra && Buffer.byteLength(JSON.stringify(parsed.data.extra)) > 32_768) {
    res.status(400).json({ error: "Extra details are too large" }); return;
  }
  if (!Object.keys(parsed.data).length) { res.status(400).json({ error: "No changes provided" }); return; }
  const [row] = await db.update(memoriesTable).set(parsed.data).where(and(
    eq(memoriesTable.id, params.data.id), eq(memoriesTable.userId, req.user.id),
  )).returning();
  if (!row) { res.status(404).json({ error: "Memory not found" }); return; }
  res.json(GetMemoryResponse.parse(serialize(row)));
});

router.delete("/memories/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to delete memories" }); return; }
  const parsed = GetMemoryParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  const [row] = await db.delete(memoriesTable).where(and(
    eq(memoriesTable.id, parsed.data.id), eq(memoriesTable.userId, req.user.id),
  )).returning();
  if (!row) { res.status(404).json({ error: "Memory not found" }); return; }
  res.sendStatus(204);
});

export default router;