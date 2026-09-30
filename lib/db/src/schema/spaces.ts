import { pgTable, uuid, varchar, text, boolean, timestamp, integer, bigint, primaryKey, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth";
import { memoriesTable } from "./memories";

export const spacesTable = pgTable("spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["project", "person", "trip", "topic"] }).notNull(),
  name: text("name").notNull(), description: text("description"),
  icon: text("icon").notNull(), color: text("color").notNull().default("gold"),
  pinned: boolean("pinned").notNull().default(false), archived: boolean("archived").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.id),
  check("spaces_kind", sql`${t.kind} IN ('project','person','trip','topic')`),
  check("spaces_color", sql`${t.color} IN ('gold','amber','bronze','sand')`),
  check("spaces_icon", sql`${t.icon} IN ('briefcase','user','plane','hash','heart','book','sparkles','map')`)]);
export const spaceMemoriesTable = pgTable("space_memories", {
  space_id: uuid("space_id").notNull(), memory_id: integer("memory_id").notNull(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["ai", "manual"] }).notNull(),
  status: text("status", { enum: ["suggested", "confirmed", "dismissed"] }).notNull(),
  reason: text("reason").notNull().default(""), confidence: integer("confidence").notNull().default(100),
}, (t) => [primaryKey({ columns: [t.space_id, t.memory_id] }),
  foreignKey({ columns: [t.userId, t.space_id], foreignColumns: [spacesTable.userId, spacesTable.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.userId, t.memory_id], foreignColumns: [memoriesTable.userId, memoriesTable.id] }).onDelete("cascade")]);
export const spaceCreationSuggestionsTable = pgTable("space_creation_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["project", "person", "trip", "topic"] }).notNull(),
  name: text("name").notNull(), normalized_name: text("normalized_name").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["suggested", "confirmed", "dismissed"] }).notNull().default("suggested"),
  space_id: uuid("space_id").references(() => spacesTable.id, { onDelete: "set null" }),
}, (t) => [unique().on(t.userId, t.normalized_name)]);
export const spaceProfileHiddenTable = pgTable("space_profile_hidden", {
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  space_id: uuid("space_id").notNull(), item_id: text("item_id").notNull(),
}, (t) => [primaryKey({ columns: [t.space_id, t.item_id] }),
  foreignKey({ columns: [t.userId, t.space_id], foreignColumns: [spacesTable.userId, spacesTable.id] }).onDelete("cascade")]);
export const spaceMatchingJobsTable = pgTable("space_matching_jobs", {
  memory_id: integer("memory_id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  generation: bigint("generation", { mode: "number" }).notNull().default(1),
  completed: boolean("completed").notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
  next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lease_until: timestamp("lease_until", { withTimezone: true }),
  lease_token: text("lease_token"), last_error: text("last_error"),
}, (t) => [foreignKey({ columns: [t.userId, t.memory_id], foreignColumns: [memoriesTable.userId, memoriesTable.id] }).onDelete("cascade")]);