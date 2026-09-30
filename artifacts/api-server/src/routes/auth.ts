import { Router, type IRouter, type Request } from "express";
import { db, memoriesTable, uploadsTable, usersTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { publicUser } from "../lib/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { activeCaptures, activeQuestions, activeUploadRequests, deletingUsers } from "../lib/brain-state";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes");
const signup = z.object({
  email, password, name: z.string().trim().min(1).max(120),
  language: z.enum(["en", "ar"]), theme: z.enum(["system", "light", "dark"]),
}).strict();
const login = z.object({ email, password: z.string() }).strict();
const profile = signup.pick({ name: true, language: true, theme: true }).partial()
  .extend({ onboardingCompleted: z.boolean().optional() }).strict();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." } });

function establish(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => {
    if (error) return reject(error);
    req.session.userId = userId;
    req.session.save((saveError) => saveError ? reject(saveError) : resolve());
  }));
}
function destroy(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}

router.post("/auth/signup", limiter, async (req, res) => {
  const parsed = signup.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid signup details (password must be 8–72 UTF-8 bytes)" }); return; }
  const { email, password, name, language, theme } = parsed.data;
  const hash = await bcrypt.hash(password, 12);
  try {
    const user = await db.transaction(async (tx) => {
      const [row] = await tx.insert(usersTable).values({ email, passwordHash: hash, name, language, theme }).returning();
      const examples = [
        ["Welcome to your second brain", "Capture a thought, link, or note here anytime."],
        ["Try asking your brain", "Ask a question and Brain Lite searches only your own memories."],
        ["Plan an appointment", "Save the date and details of an upcoming appointment."],
        ["Remember a receipt", "Keep important purchase information together."],
        ["Your daily brief", "See an overview of your upcoming tasks and plans."],
      ];
      await tx.insert(memoriesTable).values(examples.map(([title, raw_text]) => ({
        userId: row.id, title, raw_text, summary: raw_text, tags: ["sample"],
        status: "confirmed" as const, confidence: 100, is_sample: true,
      })));
      return row;
    });
    await establish(req, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Email already registered" }); return;
    }
    throw error;
  }
});

router.post("/auth/login", limiter, async (req, res) => {
  const parsed = login.safeParse(req.body);
  if (!parsed.success) { res.status(401).json({ error: "Invalid email or password" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" }); return;
  }
  await establish(req, user.id);
  res.json({ user: publicUser(user) });
});
router.post("/auth/logout", async (req, res) => {
  await destroy(req);
  res.clearCookie("brain.sid", { path: "/" });
  res.sendStatus(204);
});
router.get("/auth/me", (req, res) => res.json({ user: req.user }));
router.patch("/auth/profile", async (req, res) => {
  const parsed = profile.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) { res.status(400).json({ error: "Invalid profile changes" }); return; }
  const [row] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, req.user!.id)).returning();
  if (!row) { res.sendStatus(401); return; }
  res.json({ user: publicUser(row) });
});
router.post("/auth/password", async (req, res) => {
  const parsed = z.object({ currentPassword: z.string(), newPassword: password }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid password details" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    res.status(401).json({ error: "Invalid password" }); return;
  }
  await db.update(usersTable).set({ passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) })
    .where(eq(usersTable.id, user.id));
  // Revoke all other sessions. PostgreSQL sessions store only userId, never passwords.
  await pool.query("DELETE FROM sessions WHERE sess->>'userId' = $1 AND sid <> $2", [user.id, req.sessionID]);
  res.sendStatus(204);
});
router.delete("/auth/account", async (req, res) => {
  const parsed = z.object({ confirmation: z.literal("DELETE"), password: z.string() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm deletion with your password" }); return; }
  const userId = req.user!.id;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid password" }); return;
  }
  if (deletingUsers.has(userId) || activeCaptures.has(userId) || activeUploadRequests.has(userId) || activeQuestions.has(userId)) {
    res.status(409).json({ error: "Please wait for current activity to finish and retry" }); return;
  }
  deletingUsers.add(userId);
  try {
    const uploads = await db.select({ path: uploadsTable.path }).from(uploadsTable).where(eq(uploadsTable.userId, userId));
    for (const upload of uploads) {
      try { await (await storage.getObjectEntityFile(upload.path)).delete({ ignoreNotFound: true }); }
      catch (error) { if (!(error instanceof ObjectNotFoundError)) throw error; }
    }
    await db.transaction(async (tx) => {
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    });
    await pool.query("DELETE FROM sessions WHERE sess->>'userId' = $1", [userId]);
    await destroy(req);
    res.clearCookie("brain.sid", { path: "/" });
    res.sendStatus(204);
  } catch {
    res.status(503).json({ error: "Account deletion could not finish. Please retry." });
  } finally { deletingUsers.delete(userId); }
});
export default router;