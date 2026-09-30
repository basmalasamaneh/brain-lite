import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, spacesTable, spaceMemoriesTable, memoriesTable } from "@workspace/db";
import { ConnectionError, ownerTransaction, requireMemory } from "../lib/connections";
import { confirmedMembers, createSpace, queueOwnedMemories, refreshCreationSuggestions, requireSpace, serializeSpace } from "../lib/spaces";
import { normalizeSpaceName, personProfile, spaceBody } from "../lib/spaces-utils";
import { publicMemory } from "../lib/semantic-search";
import { deletingUsers } from "../lib/brain-state";

const router: IRouter = Router();
const uuid = z.string().uuid();
const memoryId = z.coerce.number().int().positive();
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof ConnectionError) { res.status(error.status).json({ error: error.message }); return; }
      if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid Space request" }); return; }
      req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Space request failed");
      res.status(503).json({ error: "Spaces are unavailable. Please retry." });
    }
  };
}
router.use("/spaces", (req, res, next) => {
  if (deletingUsers.has(req.user!.id) && !["GET", "HEAD"].includes(req.method)) {
    res.status(409).json({ error: "Personal data deletion is in progress." }); return;
  }
  next();
});
router.get("/spaces", route(async (req, res) => {
  const archived = req.query.archived;
  if (archived !== undefined && archived !== "true" && archived !== "false") throw new ConnectionError(400, "Invalid archived filter");
  const rows = await db.select({ space: spacesTable,
    memory_count: sql<number>`(SELECT count(*)::int FROM space_memories sm WHERE sm.user_id=${req.user!.id} AND sm.space_id=${spacesTable.id} AND sm.status='confirmed')`,
  }).from(spacesTable).where(and(eq(spacesTable.userId, req.user!.id),
    archived === undefined ? undefined : eq(spacesTable.archived, archived === "true")))
    .orderBy(sql`${spacesTable.pinned} DESC, ${spacesTable.updated_at} DESC`);
  res.json({ spaces: rows.map(({ space, memory_count }) => ({ ...serializeSpace(space), memory_count })) });
}));
router.post("/spaces", route(async (req, res) => {
  const id = await createSpace(req.user!.id, spaceBody.parse(req.body));
  res.status(201).json({ space: serializeSpace(await requireSpace(req.user!.id, id)) });
}));
router.get("/spaces/suggestions", route(async (req, res) => {
  const candidates = await refreshCreationSuggestions(req.user!.id);
  const spaces = await db.select().from(spacesTable).where(eq(spacesTable.userId, req.user!.id));
  const { rows } = await pool.query("SELECT id,kind,name,reason,normalized_name FROM space_creation_suggestions WHERE user_id=$1 AND status='suggested'", [req.user!.id]);
  res.json({ suggestions: rows.filter((row) => (candidates.get(row.normalized_name)?.ids.size ?? 0) >= 3 &&
    !spaces.some((space) => normalizeSpaceName(space.name) === row.normalized_name))
    .map(({ normalized_name: _key, ...row }) => row) });
}));
router.post("/spaces/suggestions/:id/confirm", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const spaceId = await ownerTransaction(req.user!.id, async (tx) => {
    const suggestion = (await tx.query("SELECT * FROM space_creation_suggestions WHERE user_id=$1 AND id=$2 FOR UPDATE", [req.user!.id, id])).rows[0];
    if (!suggestion) throw new ConnectionError(404, "Suggestion not found");
    if (suggestion.status === "dismissed") throw new ConnectionError(409, "Dismissed suggestions cannot be restored");
    if (suggestion.status === "confirmed") {
      if (!suggestion.space_id) throw new ConnectionError(409, "The suggested Space was deleted");
      return suggestion.space_id as string;
    }
    const existing = (await tx.query("SELECT id,name FROM spaces WHERE user_id=$1", [req.user!.id])).rows
      .find((space) => normalizeSpaceName(space.name) === suggestion.normalized_name);
    if (!existing) {
      const evidence = (await tx.query("SELECT title,people,tags FROM memories WHERE user_id=$1 AND NOT is_sample FOR KEY SHARE", [req.user!.id])).rows;
      const count = evidence.filter((m) => [m.title, ...m.people, ...m.tags].some((value) => normalizeSpaceName(value) === suggestion.normalized_name)).length;
      if (count < 3) throw new ConnectionError(409, "This suggestion no longer has three supporting memories");
    }
    const created = existing?.id ?? await createSpace(req.user!.id, { kind: suggestion.kind, name: suggestion.name }, tx);
    await tx.query("UPDATE space_creation_suggestions SET status='confirmed',space_id=$3 WHERE user_id=$1 AND id=$2", [req.user!.id, id, created]);
    return created as string;
  });
  res.json({ space: serializeSpace(await requireSpace(req.user!.id, spaceId)) });
}));
router.post("/spaces/suggestions/:id/dismiss", route(async (req, res) => {
  const result = await pool.query("UPDATE space_creation_suggestions SET status='dismissed' WHERE user_id=$1 AND id=$2 RETURNING id", [req.user!.id, uuid.parse(req.params.id)]);
  if (!result.rowCount) throw new ConnectionError(404, "Suggestion not found");
  res.sendStatus(204);
}));
router.get("/memories/:id/spaces", route(async (req, res) => {
  const id = memoryId.parse(req.params.id);
  await requireMemory(req.user!.id, id);
  const rows = await db.select({ space: spacesTable }).from(spaceMemoriesTable)
    .innerJoin(spacesTable, and(eq(spacesTable.id, spaceMemoriesTable.space_id), eq(spacesTable.userId, req.user!.id)))
    .where(and(eq(spaceMemoriesTable.userId, req.user!.id), eq(spaceMemoriesTable.memory_id, id), eq(spaceMemoriesTable.status, "confirmed")));
  res.json({ spaces: rows.map(({ space }) => serializeSpace(space)) });
}));
router.get("/memories/:id/space-suggestions", route(async (req, res) => {
  const id = memoryId.parse(req.params.id);
  await requireMemory(req.user!.id, id);
  const rows = await db.select({ space: spacesTable, reason: spaceMemoriesTable.reason, confidence: spaceMemoriesTable.confidence })
    .from(spaceMemoriesTable)
    .innerJoin(spacesTable, and(eq(spacesTable.id, spaceMemoriesTable.space_id), eq(spacesTable.userId, req.user!.id)))
    .where(and(eq(spaceMemoriesTable.userId, req.user!.id), eq(spaceMemoriesTable.memory_id, id),
      eq(spaceMemoriesTable.status, "suggested"), eq(spacesTable.archived, false)));
  res.json({ suggestions: rows.map(({ space, reason, confidence }) => ({ space: serializeSpace(space), reason, confidence })) });
}));
router.get("/spaces/:id", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const space = await requireSpace(req.user!.id, id);
  const memories = await confirmedMembers(req.user!.id, id);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = memories.filter((m) => m.event_date && /^\d{4}-\d{2}-\d{2}/.test(m.event_date) && m.event_date.slice(0, 10) >= today)
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!));
  const tasks = memories.filter((m) => m.type === "task" && m.extra.completed !== true && !["done", "completed", "cancelled"].includes(String(m.extra.status ?? "")));
  const hidden = await pool.query("SELECT item_id FROM space_profile_hidden WHERE user_id=$1 AND space_id=$2", [req.user!.id, id]);
  res.json({ space: serializeSpace(space), counts: { memories: memories.length, upcoming: upcoming.length, tasks: tasks.length },
    upcoming: upcoming.map(publicMemory), open_tasks: tasks.map(publicMemory),
    profile: space.kind === "person" ? personProfile(memories, new Set(hidden.rows.map((r) => r.item_id))) : null });
}));
router.patch("/spaces/:id", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await requireSpace(req.user!.id, id);
  const data = spaceBody.partial().parse(req.body);
  if (!Object.keys(data).length) throw new ConnectionError(400, "No changes provided");
  await db.update(spacesTable).set({ ...data, updated_at: new Date() }).where(and(eq(spacesTable.userId, req.user!.id), eq(spacesTable.id, id)));
  if (data.name || data.description !== undefined || data.archived === false) await ownerTransaction(req.user!.id, (tx) => queueOwnedMemories(tx, req.user!.id));
  res.json({ space: serializeSpace(await requireSpace(req.user!.id, id)) });
}));
router.delete("/spaces/:id", route(async (req, res) => {
  const rows = await db.delete(spacesTable).where(and(eq(spacesTable.userId, req.user!.id), eq(spacesTable.id, uuid.parse(req.params.id)))).returning();
  if (!rows.length) throw new ConnectionError(404, "Space not found");
  res.sendStatus(204);
}));
router.get("/spaces/:id/memories", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await requireSpace(req.user!.id, id);
  const filter = z.enum(["all", "events", "documents", "tasks", "notes", "links"]).parse(req.query.filter ?? "all");
  const rows = await db.select({ memory: memoriesTable, membership: spaceMemoriesTable }).from(spaceMemoriesTable)
    .innerJoin(memoriesTable, and(eq(memoriesTable.id, spaceMemoriesTable.memory_id), eq(memoriesTable.userId, req.user!.id)))
    .where(and(eq(spaceMemoriesTable.userId, req.user!.id), eq(spaceMemoriesTable.space_id, id)))
    .orderBy(sql`${memoriesTable.created_at} DESC`);
  const accepted = (m: typeof memoriesTable.$inferSelect) => filter === "all" ||
    filter === "events" && m.type === "appointment" || filter === "documents" && ["document", "receipt"].includes(m.type) ||
    filter === "tasks" && m.type === "task" || filter === "notes" && ["note", "idea", "other"].includes(m.type) ||
    filter === "links" && /https?:\/\//i.test(m.raw_text);
  res.json({
    memories: rows.filter((r) => r.membership.status === "confirmed" && accepted(r.memory)).map((r) => publicMemory(r.memory)),
    suggestions: rows.filter((r) => r.membership.status === "suggested" && accepted(r.memory)).map((r) => ({
      memory: publicMemory(r.memory), reason: r.membership.reason, confidence: r.membership.confidence,
    })),
  });
}));
router.post("/spaces/:id/memories", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z.object({ memory_id: memoryId }).strict().parse(req.body);
  await requireSpace(req.user!.id, id);
  await requireMemory(req.user!.id, body.memory_id);
  const result = await pool.query(`INSERT INTO space_memories(user_id,space_id,memory_id,source,status)
    VALUES($1,$2,$3,'manual','confirmed') ON CONFLICT(space_id,memory_id) DO UPDATE SET
    source='manual',status='confirmed',confidence=100 WHERE space_memories.user_id=$1 AND space_memories.status<>'dismissed' RETURNING memory_id`,
  [req.user!.id, id, body.memory_id]);
  if (!result.rowCount) throw new ConnectionError(409, "This membership was dismissed and cannot be restored");
  res.sendStatus(204);
}));
router.delete("/spaces/:id/memories/:memoryId", route(async (req, res) => {
  const id = uuid.parse(req.params.id), mid = memoryId.parse(req.params.memoryId);
  await requireSpace(req.user!.id, id); await requireMemory(req.user!.id, mid);
  await pool.query(`INSERT INTO space_memories(user_id,space_id,memory_id,source,status)
    VALUES($1,$2,$3,'manual','dismissed') ON CONFLICT(space_id,memory_id) DO UPDATE SET status='dismissed' WHERE space_memories.user_id=$1`, [req.user!.id, id, mid]);
  res.sendStatus(204);
}));
router.delete("/spaces/:id/profile/:itemId", route(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const space = await requireSpace(req.user!.id, id);
  const itemId = z.string().regex(/^\d+-[a-f0-9]{24}$/).parse(req.params.itemId);
  const hidden = await pool.query("SELECT item_id FROM space_profile_hidden WHERE user_id=$1 AND space_id=$2 AND item_id=$3", [req.user!.id, id, itemId]);
  const profile = personProfile(await confirmedMembers(req.user!.id, id), new Set());
  if (space.kind !== "person" || !hidden.rowCount && !profile.items.some((item) => item.id === itemId)) throw new ConnectionError(404, "Profile item not found");
  await pool.query("INSERT INTO space_profile_hidden(user_id,space_id,item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [req.user!.id, id, itemId]);
  res.sendStatus(204);
}));
export default router;