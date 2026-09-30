import { pgTable, serial, text, integer, timestamp, doublePrecision, jsonb, varchar, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoriesTable = pgTable("memories", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  is_sample: boolean("is_sample").notNull().default(false),
  type: text("type", { enum: ["appointment", "receipt", "task", "idea", "document", "note", "other"] }).notNull().default("note"),
  title: text("title").notNull(),
  summary: text("summary"),
  raw_text: text("raw_text").notNull().default(""),
  transcript: text("transcript"),
  event_date: text("event_date"),
  amount: doublePrecision("amount"),
  currency: text("currency"),
  people: text("people").array().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  confidence: integer("confidence").notNull().default(0),
  status: text("status", { enum: ["confirmed", "needs_review"] }).notNull().default("needs_review"),
  file_path: text("file_path"),
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  extraction_status: text("extraction_status", { enum: ["legacy", "processing", "extracted", "fallback"] }).notNull().default("legacy"),
  extraction_error: text("extraction_error", { enum: ["not_configured", "unavailable", "invalid_response", "unsupported_file"] }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("memories_owner_identity").on(table.userId, table.id)]);

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, created_at: true });
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type MemoryRow = typeof memoriesTable.$inferSelect;