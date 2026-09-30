import express, { type Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { aiBudgetMiddleware } from "./lib/ai-budget";

const app: Express = express();
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) throw new Error("SESSION_SECRET (at least 32 characters) is required");
app.set("trust proxy", 1);
app.use(helmet());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The base64 representation of a 5 MiB recording is ~6.99 MiB. Only this
// specific route gets the larger parser; decoded audio size is checked again.
app.use(["/api/capture/voice", "/api/voice/transcribe"], (req, res, next) => {
  if (req.method === "POST" && req.path === "/") return express.json({ limit: "7mb" })(req, res, next);
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === "POST" && ["/api/capture/voice", "/api/voice/transcribe"].includes(req.path) &&
    error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Recording must be 5 MB or smaller.", code: "audio_too_large" });
    return;
  }
  next(error);
});
app.use(session({
  secret: sessionSecret,
  name: "brain.sid",
  resave: false,
  saveUninitialized: false,
  store: new (connectPgSimple(session))({ pool, tableName: "sessions", createTableIfMissing: false }),
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 3600 * 1000 },
}));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin") || req.get("referer");
    const host = req.get("x-forwarded-host") || req.get("host");
    let crossSite = req.get("sec-fetch-site") === "cross-site";
    if (origin) {
      try {
        const source = new URL(origin);
        crossSite ||= !host || source.host !== host || !["http:", "https:"].includes(source.protocol);
      } catch { crossSite = true; }
    }
    if (crossSite) {
      res.status(403).json({ error: "Cross-site request rejected" });
      return;
    }
  }
  next();
});
// Authenticate all API paths except the two public credential endpoints.
app.use("/api", (req, res, next) => {
  if (req.method === "POST" && (req.path === "/auth/signup" || req.path === "/auth/login")) return next();
  // These handlers verify their own narrowly scoped Bearer/HMAC capability.
  if (req.method === "POST" && req.path === "/cron/tick") return next();
  if (req.method === "GET" && req.path === "/notifications/unsubscribe") return next();
  authMiddleware(req, res, next);
});

app.use("/api", aiBudgetMiddleware, router);

export default app;
