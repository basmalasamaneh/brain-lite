import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, memoriesTable, uploadsTable } from "@workspace/db";
import {
  CreateMemoryBody, UpdateMemoryBody, GetMemoryParams,
  ListMemoriesQueryParams, ListMemoriesResponse, GetMemoryResponse,
  GetMemoryStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/memories/stats", async (req, res): Promise<void> => {
  const scope = req.user ? eq(memoriesTable.userId, req.user.id) : isNull(memoriesTable.userId);
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
  const scope = req.user ? eq(memoriesTable.userId, req.user.id) : isNull(memoriesTable.userId);
  const { type, search } = parsed.data;
  const rows = await db.select().from(memoriesTable).where(and(
    scope,
    type && type !== "all" ? eq(memoriesTable.type, type as typeof memoriesTable.$inferSelect.type) : undefined,
    search ? or(ilike(memoriesTable.title, `%${search.slice(0, 200)}%`), ilike(memoriesTable.raw_text, `%${search.slice(0, 200)}%`)) : undefined,
  )).orderBy(desc(memoriesTable.created_at));
  res.json(ListMemoriesResponse.parse(rows.map(serialize)));
});

function serialize(row: typeof memoriesTable.$inferSelect) {
  const { userId: _userId, ...memory } = row;
  return { ...memory, created_at: row.created_at.toISOString() };
}

router.get("/memories/:id", async (req, res): Promise<void> => {
  const parsed = GetMemoryParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  const [row] = await db.select().from(memoriesTable).where(and(
    eq(memoriesTable.id, parsed.data.id),
    req.user ? eq(memoriesTable.userId, req.user.id) : isNull(memoriesTable.userId),
  ));
  if (!row) { res.status(404).json({ error: "Memory not found" }); return; }
  res.json(GetMemoryResponse.parse(serialize(row)));
});

router.post("/memories", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to save memories" }); return; }
  const parsed = CreateMemoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid capture" }); return; }
  const data = parsed.data;
  if (!data.raw_text.trim() && !data.file_path) {
    res.status(400).json({ error: "Add some text or attach a file" }); return;
  }
  if (data.file_path) {
    const [upload] = await db.select().from(uploadsTable).where(and(
      eq(uploadsTable.path, data.file_path), eq(uploadsTable.userId, req.user.id),
    ));
    if (!upload) { res.status(400).json({ error: "Invalid attachment" }); return; }
  }
  const [row] = await db.insert(memoriesTable).values({
    userId: req.user.id,
    title: data.title?.trim() || data.raw_text.trim().split("\n")[0].slice(0, 100) || "Untitled attachment",
    raw_text: data.raw_text, file_path: data.file_path || null,
    type: "note", status: "needs_review", confidence: 0,
  }).returning();
  res.status(201).json(GetMemoryResponse.parse(serialize(row)));
});

router.patch("/memories/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to edit memories" }); return; }
  const params = GetMemoryParams.safeParse(req.params);
  const parsed = UpdateMemoryBody.safeParse(req.body);
  if (!params.success || !parsed.success || (parsed.data.title !== undefined && !parsed.data.title.trim())) {
    res.status(400).json({ error: "Invalid memory data" }); return;
  }
  if (parsed.data.event_date && !Number.isFinite(Date.parse(parsed.data.event_date))) {
    res.status(400).json({ error: "Invalid event date" }); return;
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