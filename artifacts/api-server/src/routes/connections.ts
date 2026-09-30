import { Router, type IRouter, type Response, type Request } from "express";
import {
  GetConnectionSuggestionsResponse, GetMemoryConnectionsParams, GetMemoryConnectionsResponse,
  CreateMemoryConnectionParams, CreateMemoryConnectionBody, CreateMemoryConnectionResponse,
  ConfirmConnectionParams, ConfirmConnectionResponse, DismissConnectionParams, DismissConnectionResponse,
  RemoveConnectionParams, MergeConnectionParams, MergeConnectionBody, MergeConnectionResponse,
  GetConnectionSettingsResponse, UpdateConnectionSettingsBody, UpdateConnectionSettingsResponse, DiscoverConnectionsResponse,
} from "@workspace/api-zod";
import { changeConnection, ConnectionError, connectionRows, connectionSettings, manualConnection, mergeConnection, ownerTransaction, requireMemory } from "../lib/connections";
import { queueDiscovery } from "../lib/connections-discovery";
import { deletingUsers } from "../lib/brain-state";

const router: IRouter = Router();
function failure(error: unknown, req: Request, res: Response) {
  if (error instanceof ConnectionError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Connection action unavailable");
  res.status(503).json({ error: "Connections are unavailable right now. Please retry." });
}
router.use(["/connections", "/memories/:id/connections"], (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Please sign in" }); return; }
  if (deletingUsers.has(req.user!.id) && !["GET", "HEAD"].includes(req.method)) {
    res.status(409).json({ error: "Personal data deletion is in progress." }); return;
  }
  next();
});
router.get("/connections/suggestions", async (req, res): Promise<void> => {
  try { res.json(GetConnectionSuggestionsResponse.parse({ suggestions: await connectionRows(req.user!.id, { suggestions: true }) })); }
  catch (error) { failure(error, req, res); }
});
router.get("/connections/settings", async (req, res): Promise<void> => {
  try { res.json(GetConnectionSettingsResponse.parse(await connectionSettings(req.user!.id))); }
  catch (error) { failure(error, req, res); }
});
router.patch("/connections/settings", async (req, res): Promise<void> => {
  const parsed = UpdateConnectionSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A boolean automatic setting is required" }); return; }
  try {
    await ownerTransaction(req.user!.id, async (client) => {
      await client.query(`INSERT INTO connection_settings(user_id,automatic) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET automatic=EXCLUDED.automatic`, [req.user!.id, parsed.data.automatic]);
    });
    res.json(UpdateConnectionSettingsResponse.parse(await connectionSettings(req.user!.id)));
  } catch (error) { failure(error, req, res); }
});
router.post("/connections/discover", async (req, res): Promise<void> => {
  try {
    await queueDiscovery(req.user!.id, true);
    res.status(202).json(DiscoverConnectionsResponse.parse({ queued: true }));
  } catch (error) { failure(error, req, res); }
});
router.get("/memories/:id/connections", async (req, res): Promise<void> => {
  const parsed = GetMemoryConnectionsParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid memory ID" }); return; }
  try {
    await requireMemory(req.user!.id, parsed.data.id);
    const rows = await connectionRows(req.user!.id, { memoryId: parsed.data.id });
    res.json(GetMemoryConnectionsResponse.parse({ confirmed: rows.filter((row) => row.status === "confirmed"), suggested: rows.filter((row) => row.status === "suggested") }));
  } catch (error) { failure(error, req, res); }
});
router.post("/memories/:id/connections", async (req, res): Promise<void> => {
  const params = CreateMemoryConnectionParams.safeParse(req.params);
  const body = CreateMemoryConnectionBody.safeParse(req.body);
  if (!params.success || !body.success || params.data.id === body.data.other_id) { res.status(400).json({ error: "Choose a different memory and a valid relation" }); return; }
  try {
    const connection = await manualConnection(req.user!.id, params.data.id, body.data.other_id, body.data.relation_type, body.data.reason);
    res.status(201).json(CreateMemoryConnectionResponse.parse({ connection }));
  } catch (error) { failure(error, req, res); }
});
router.post("/connections/:id/confirm", async (req, res): Promise<void> => {
  const parsed = ConfirmConnectionParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid connection ID" }); return; }
  try { res.json(ConfirmConnectionResponse.parse({ connection: await changeConnection(req.user!.id, parsed.data.id, "confirmed") })); }
  catch (error) { failure(error, req, res); }
});
router.post("/connections/:id/dismiss", async (req, res): Promise<void> => {
  const parsed = DismissConnectionParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid connection ID" }); return; }
  try { res.json(DismissConnectionResponse.parse({ connection: await changeConnection(req.user!.id, parsed.data.id, "dismissed") })); }
  catch (error) { failure(error, req, res); }
});
router.delete("/connections/:id", async (req, res): Promise<void> => {
  const parsed = RemoveConnectionParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid connection ID" }); return; }
  try { await changeConnection(req.user!.id, parsed.data.id, "dismissed"); res.sendStatus(204); }
  catch (error) { failure(error, req, res); }
});
router.post("/connections/:id/merge", async (req, res): Promise<void> => {
  const params = MergeConnectionParams.safeParse(req.params);
  const body = MergeConnectionBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.confirm !== true) { res.status(400).json({ error: "Choose the memory to keep and explicitly confirm the merge" }); return; }
  try { res.json(MergeConnectionResponse.parse({ memory: await mergeConnection(req.user!.id, params.data.id, body.data.keep_memory_id) })); }
  catch (error) { failure(error, req, res); }
});
export default router;