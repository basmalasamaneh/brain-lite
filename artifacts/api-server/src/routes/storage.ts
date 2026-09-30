import { Readable } from "stream";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { db, uploadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { activeUploadRequests, deletingUsers } from "../lib/brain-state";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (deletingUsers.has(req.user.id)) {
    res.status(409).json({ error: "Personal data deletion is in progress. Please retry shortly." });
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const userId = req.user.id;
  activeUploadRequests.set(userId, (activeUploadRequests.get(userId) ?? 0) + 1);
  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    await db.insert(uploadsTable).values({
      path: objectPath, userId: req.user.id, name, size, contentType,
    });
    res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  } finally {
    const remaining = (activeUploadRequests.get(userId) ?? 1) - 1;
    if (remaining) activeUploadRequests.set(userId, remaining);
    else activeUploadRequests.delete(userId);
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
  const objectPath = `/objects/${wildcardPath}`;
  try {
    const [upload] = await db.select({ userId: uploadsTable.userId })
      .from(uploadsTable).where(eq(uploadsTable.path, objectPath));
    if (!upload || upload.userId !== req.user.id) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // Regardless of object metadata, an owned upload is never shared-cacheable.
    res.setHeader("Cache-Control", "private, no-store");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;