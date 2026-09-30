import type { RequestHandler } from "express";
import { pool } from "@workspace/db";

/** Durable counters survive restarts. Worker and interactive quotas cannot reset
 * by deleting memories, dismissing links, or changing preferences. */
export async function reserveAiBudget(userId: string, worker = false): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scopes: [string, number][] = worker
      ? [["worker:global", 120], [`worker:${userId}`, 30]]
      : [[`interactive:${userId}`, 30]];
    for (const [scope, limit] of scopes) {
      const result = await client.query(`INSERT INTO ai_usage_limits(scope,bucket,used)
        VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(scope,bucket)
        DO UPDATE SET used=ai_usage_limits.used+1 WHERE ai_usage_limits.used<$2 RETURNING used`, [scope, limit]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return false; }
    }
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export const aiBudgetMiddleware: RequestHandler = async (req, res, next) => {
  const usesAi = req.method === "POST" && ["/memories", "/brain/ask", "/capture/voice", "/voice/transcribe", "/connections/discover", "/indexing/reindex"].includes(req.path)
    || req.method === "GET" && req.path === "/search/related";
  if (!usesAi) { next(); return; }
  try {
    if (!await reserveAiBudget(req.user!.id)) {
      res.status(429).json({ error: "AI request limit reached. Retry after the current hour." }); return;
    }
    next();
  } catch {
    res.status(503).json({ error: "AI request budget is unavailable. Please retry." });
  }
};