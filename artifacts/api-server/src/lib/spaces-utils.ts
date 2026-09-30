import { z } from "zod";
import { createHash } from "node:crypto";
import { validEventDate } from "./calendar";

export const spaceKinds = ["project", "person", "trip", "topic"] as const;
export const defaultIcons = { project: "briefcase", person: "user", trip: "plane", topic: "hash" } as const;
export const spaceBody = z.object({
  kind: z.enum(spaceKinds), name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.enum(["briefcase", "user", "plane", "hash", "heart", "book", "sparkles", "map"]).optional(),
  color: z.enum(["gold", "amber", "bronze", "sand"]).optional(),
  pinned: z.boolean().optional(), archived: z.boolean().optional(),
}).strict();
export const spaceIdBody = z.string().uuid().optional();
export function normalizeSpaceName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[ً-ٰٟ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const matchesSchema = z.object({ matches: z.array(z.object({
  space_id: z.string().uuid(), confidence: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(500),
}).strict()).max(8) }).strict();
export function parseSpaceMatches(text: string, allowed: Set<string>) {
  const parsed = matchesSchema.parse(JSON.parse(text));
  const seen = new Set<string>();
  return parsed.matches.filter((match) => {
    if (!allowed.has(match.space_id) || match.confidence < 75 || seen.has(match.space_id)) return false;
    seen.add(match.space_id); return true;
  });
}
type ProfileMemory = { id: number; type: string; raw_text: string; extra: Record<string, unknown>; created_at: Date; event_date?: string | null };
export function personProfile(memories: ProfileMemory[], hidden: Set<string>, now = new Date()) {
  const items: { id: string; kind: string; value: string; memory_id: number }[] = [];
  const secret = /password|passwd|api[_ -]?key|secret|token|bearer|private\s*key|\botp\b|sk-[a-zA-Z0-9]{16,}|AIza[a-zA-Z0-9_-]{20,}|كلمة\s*(?:السر|المرور)|رمز\s*(?:التحقق|الدخول)/i;
  for (const memory of memories) {
    // Explicit contacts only; no model, inference or private credential fields.
    const values: [string, string][] = [];
    for (const key of ["email", "phone", "address", "contact_email", "contact_phone"]) {
      const value = memory.extra?.[key];
      if (typeof value === "string" && value.trim()) values.push([key, value.trim().slice(0, 500)]);
    }
    if (!secret.test(memory.raw_text)) {
      for (const email of memory.raw_text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []) values.push(["email", email]);
      for (const phone of memory.raw_text.match(/(?:\+\d[\d ()-]{7,}\d)/g) ?? []) values.push(["phone", phone]);
      if (memory.type === "note" && memory.raw_text.trim()) values.push(["note", memory.raw_text.trim().slice(0, 500)]);
    }
    for (const [kind, value] of values) {
      if (secret.test(value)) continue;
      // A note is a source-backed item, so hiding it survives later text edits.
      // Different explicit contacts in the same source remain independently removable.
      const id = `${memory.id}-${createHash("sha256").update(kind === "note" ? kind : `${kind}:${value}`).digest("hex").slice(0, 24)}`;
      if (!hidden.has(id) && !items.some((item) => item.id === id)) items.push({ id, kind, value, memory_id: memory.id });
    }
  }
  const pastEvents = memories.flatMap((memory) => {
    const date = memory.event_date;
    if (!date || !validEventDate(date)) return [];
    // Keep date-only/floating values in their original form, rather than
    // fabricate a timezone. UTC is the deterministic comparison clock.
    const timestamp = Date.parse(/T/.test(date) && !/(Z|[+-]\d{2}:\d{2})$/.test(date) ? `${date}Z` : date);
    return Number.isFinite(timestamp) && timestamp <= +now ? [{ date, timestamp }] : [];
  }).sort((a, b) => b.timestamp - a.timestamp);
  // A recently imported old event is not a recent interaction. Undated notes
  // and future appointments do not establish a past interaction at all.
  return { last_interaction: pastEvents[0]?.date ?? null, items };
}