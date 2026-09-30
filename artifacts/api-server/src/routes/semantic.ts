import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { SearchRelatedQueryParams, SearchRelatedResponse, GetSimilarMemoriesParams, GetSimilarMemoriesResponse, GetIndexingStatusResponse, ReindexMemoriesResponse } from "@workspace/api-zod";
import { indexingStatus, publicMemory, reindex, relatedMemories, similarMemories } from "../lib/semantic-search";
import { validDateFilter } from "../lib/semantic-utils";
import { deletingUsers } from "../lib/brain-state";
import { providerDiagnostic } from "../lib/gemini-provider";

const router: IRouter = Router();
const semanticLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30,
  keyGenerator: (req) => req.user!.id, message: { error: "AI request limit reached. Retry later." } });
const reindexLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6,
  keyGenerator: (req) => req.user!.id, message: { error: "Re-index limit reached. Retry later." } });
const serialize = (rows: Awaited<ReturnType<typeof relatedMemories>>) => ({
  memories: rows.map(({ memory, relevance }) => ({ ...publicMemory(memory), relevance })),
});
router.get("/search/related", semanticLimiter, async (req, res): Promise<void> => {
  const parsed = SearchRelatedQueryParams.safeParse(req.query);
  if (!parsed.success || !parsed.data.q.trim() || !validDateFilter(parsed.data.date_from) ||
    !validDateFilter(parsed.data.date_to) || parsed.data.date_from && parsed.data.date_to && parsed.data.date_from > parsed.data.date_to) {
    res.status(400).json({ error: "Invalid search or date filters" }); return;
  }
  try {
    res.json(SearchRelatedResponse.parse(serialize(await relatedMemories(req.user!.id, parsed.data.q, parsed.data))));
  } catch (error) {
    req.log.warn(providerDiagnostic(error), "Semantic search unavailable");
    res.status(503).json({ error: "Semantic search is unavailable right now. Keyword search still works." });
  }
});
router.get("/memories/:id/similar", async (req, res): Promise<void> => {
  const parsed = GetSimilarMemoriesParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  try {
    const rows = await similarMemories(req.user!.id, parsed.data.id);
    if (rows === null) { res.status(404).json({ error: "Memory not found" }); return; }
    res.json(GetSimilarMemoriesResponse.parse(serialize(rows)));
  } catch {
    res.status(503).json({ error: "Similar memories are unavailable right now." });
  }
});
router.get("/indexing/status", async (req, res): Promise<void> => {
  try { res.json(GetIndexingStatusResponse.parse(await indexingStatus(req.user!.id))); }
  catch { res.status(503).json({ error: "Indexing status is unavailable right now." }); }
});
router.post("/indexing/reindex", reindexLimiter, async (req, res): Promise<void> => {
  if (deletingUsers.has(req.user!.id)) { res.status(409).json({ error: "Personal data deletion is in progress." }); return; }
  try { res.json(ReindexMemoriesResponse.parse(await reindex(req.user!.id))); }
  catch { res.status(503).json({ error: "Unable to queue re-indexing right now." }); }
});
export default router;