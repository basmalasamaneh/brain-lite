import { Router, type IRouter } from "express";
import { GetGraphResponse } from "@workspace/api-zod";
import { ConnectionError } from "../lib/connections";
import { graphQuery } from "../lib/graph-utils";
import { getOwnerGraph } from "../lib/graph";

const router: IRouter = Router();
router.get("/graph", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in to explore your graph" }); return; }
  const parsed = graphQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid graph filters", details: parsed.error.issues.map((issue) => issue.message) });
    return;
  }
  try { res.json(GetGraphResponse.parse(await getOwnerGraph(req.user!.id, parsed.data))); }
  catch (error) {
    if (error instanceof ConnectionError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Graph unavailable");
    res.status(503).json({ error: "Your graph is unavailable right now. Please retry." });
  }
});
export default router;