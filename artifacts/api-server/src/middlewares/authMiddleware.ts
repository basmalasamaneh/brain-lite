import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "@workspace/api-zod";
import { publicUser } from "../lib/auth";
import { deletingUsers } from "../lib/brain-state";

declare module "express-session" {
  interface SessionData { userId?: string }
}
declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User;
    }
    interface AuthedRequest { user: User }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  req.isAuthenticated = function (this: Request) {
    return !!this.user;
  } as Request["isAuthenticated"];
  try {
    if (req.session.userId) {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
      if (row) req.user = publicUser(row);
      else req.session.userId = undefined;
    }
    if (!req.user || deletingUsers.has(req.user.id)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  } catch (error) { next(error); }
}