import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, integer, text, timestamp, boolean, bigint, date, primaryKey, unique, check, foreignKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { memoriesTable } from "./memories";

export const memoryLinksTable = pgTable("memory_links", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  memory_a_id: integer("memory_a_id").notNull(),
  memory_b_id: integer("memory_b_id").notNull(),
  source: text("source", { enum: ["ai", "manual"] }).notNull(),
  status: text("status", { enum: ["suggested", "confirmed", "dismissed"] }).notNull(),
  relation_type: text("relation_type", { enum: ["same_event", "same_person", "same_project", "same_topic", "follow_up", "duplicate", "other"] }).notNull(),
  reason: text("reason").notNull().default(""),
  confidence: integer("confidence").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.userId, t.memory_a_id, t.memory_b_id),
  check("memory_links_order", sql`${t.memory_a_id}<${t.memory_b_id}`),
  check("memory_links_confidence", sql`${t.confidence} BETWEEN 0 AND 100`),
  check("memory_links_source", sql`${t.source} IN ('ai','manual')`),
  check("memory_links_status", sql`${t.status} IN ('suggested','confirmed','dismissed')`),
  check("memory_links_relation_type", sql`${t.relation_type} IN ('same_event','same_person','same_project','same_topic','follow_up','duplicate','other')`),
  foreignKey({ columns: [t.userId, t.memory_a_id], foreignColumns: [memoriesTable.userId, memoriesTable.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.userId, t.memory_b_id], foreignColumns: [memoriesTable.userId, memoriesTable.id] }).onDelete("cascade"),
  index("memory_links_owner_status").on(t.userId, t.status),
  index("memory_links_owner_b").on(t.userId, t.memory_b_id),
]);

export const connectionSettingsTable = pgTable("connection_settings", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  automatic: boolean("automatic").notNull().default(true),
  nextWeeklyAt: timestamp("next_weekly_at", { withTimezone: true }).notNull().defaultNow(),
  scanCursor: integer("scan_cursor").notNull().default(0),
  schedulerAttempts: integer("scheduler_attempts").notNull().default(0),
  schedulerRetryAt: timestamp("scheduler_retry_at", { withTimezone: true }).notNull().defaultNow(),
  schedulerLeaseUntil: timestamp("scheduler_lease_until", { withTimezone: true }),
  schedulerLeaseToken: text("scheduler_lease_token"),
  lastSchedulerError: text("last_scheduler_error"),
});
export const connectionDailyUsageTable = pgTable("connection_daily_usage", {
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  used: integer("used").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] }), check("connection_daily_cap", sql`${t.used} BETWEEN 0 AND 3`)]);
export const aiUsageLimitsTable = pgTable("ai_usage_limits", {
  scope: text("scope").notNull(),
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  used: integer("used").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.scope, t.bucket] })]);
export const connectionDiscoveryJobsTable = pgTable("connection_discovery_jobs", {
  memoryId: integer("memory_id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  generation: bigint("generation", { mode: "number" }).notNull().default(1),
  explicit: boolean("explicit").notNull().default(false),
  forgotten: boolean("forgotten").notNull().default(false),
  completed: boolean("completed").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseToken: text("lease_token"),
  lastError: text("last_error"),
}, (t) => [foreignKey({ columns: [t.userId, t.memoryId], foreignColumns: [memoriesTable.userId, memoriesTable.id] }).onDelete("cascade")]);