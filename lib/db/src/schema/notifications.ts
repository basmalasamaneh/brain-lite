import { sql } from "drizzle-orm";
import { pgTable, varchar, text, boolean, integer, timestamp, uuid, bigint, date, primaryKey, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { memoriesTable } from "./memories";

const owner = () => varchar("user_id").notNull().references(()=>usersTable.id,{onDelete:"cascade"});
const created = () => timestamp("created_at",{withTimezone:true}).notNull().defaultNow();
export const notificationSettingsTable=pgTable("notification_settings",{
  userId:owner().primaryKey(),timezone:text("timezone").notNull().default("UTC"),
  timezone_initialized:boolean("timezone_initialized").notNull().default(false),
  push_enabled:boolean("push_enabled").notNull().default(false),email_enabled:boolean("email_enabled").notNull().default(false),
  daily_brief_enabled:boolean("daily_brief_enabled").notNull().default(false),daily_brief_time:text("daily_brief_time").notNull().default("08:00"),
  quiet_hours_start:text("quiet_hours_start").notNull().default("22:00"),quiet_hours_end:text("quiet_hours_end").notNull().default("07:00"),
  remind_appointments:boolean("remind_appointments").notNull().default(true),remind_tasks:boolean("remind_tasks").notNull().default(true),
  remind_expiries:boolean("remind_expiries").notNull().default(true),remind_suggestions:boolean("remind_suggestions").notNull().default(true),
  default_lead_days:integer("default_lead_days").array().notNull().default(sql`'{7,1}'::integer[]`),
  hide_details:boolean("hide_details").notNull().default(true),suspended:boolean("suspended").notNull().default(false),
});
export const pushSubscriptionsTable=pgTable("push_subscriptions",{
  id:uuid("id").primaryKey().defaultRandom(),userId:owner(),endpoint:text("endpoint").notNull().unique(),
  p256dh:text("p256dh").notNull(),auth:text("auth").notNull(),session_id:text("session_id").notNull(),user_agent:text("user_agent"),
  created_at:created(),last_used_at:timestamp("last_used_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("push_owner").on(t.userId)]);
export const memoryReminderSettingsTable=pgTable("memory_reminder_settings",{
  memory_id:integer("memory_id").primaryKey(),userId:owner(),
  mode:text("mode",{enum:["automatic","none","lead_times","specific"]}).notNull().default("automatic"),
  lead_minutes:integer("lead_minutes").array().notNull().default(sql`'{}'::integer[]`),specific_at:timestamp("specific_at",{withTimezone:true}),
},t=>[foreignKey({columns:[t.userId,t.memory_id],foreignColumns:[memoriesTable.userId,memoriesTable.id]}).onDelete("cascade")]);
export const remindersTable=pgTable("reminders",{
  id:uuid("id").primaryKey().defaultRandom(),userId:owner(),memory_id:integer("memory_id").notNull(),
  kind:text("kind",{enum:["appointment","task","expiry","custom"]}).notNull(),fire_at:timestamp("fire_at",{withTimezone:true}).notNull(),
  event_at:timestamp("event_at",{withTimezone:true}),original_fire_at:timestamp("original_fire_at",{withTimezone:true}).notNull(),
  status:text("status",{enum:["pending","sent","snoozed","done","dismissed"]}).notNull().default("pending"),
  sent_at:timestamp("sent_at",{withTimezone:true}),created_at:created(),
},t=>[unique().on(t.memory_id,t.kind,t.fire_at),
  foreignKey({columns:[t.userId,t.memory_id],foreignColumns:[memoriesTable.userId,memoriesTable.id]}).onDelete("cascade"),
  index("reminders_due").on(t.fire_at).where(sql`${t.status} IN ('pending','snoozed')`),index("reminders_owner").on(t.userId,t.memory_id)]);
export const reminderDeliveryClaimsTable=pgTable("reminder_delivery_claims",{
  memory_id:integer("memory_id").notNull(),userId:owner(),kind:text("kind").notNull(),fire_at:timestamp("fire_at",{withTimezone:true}).notNull(),
  claimed_at:timestamp("claimed_at",{withTimezone:true}).notNull().defaultNow(),
  reason:text("reason").notNull().default("delivery"),
},t=>[primaryKey({columns:[t.memory_id,t.kind,t.fire_at]}),
  foreignKey({columns:[t.userId,t.memory_id],foreignColumns:[memoriesTable.userId,memoriesTable.id]}).onDelete("cascade")]);
export const reminderRecomputeJobsTable=pgTable("reminder_recompute_jobs",{
  memory_id:integer("memory_id").primaryKey(),userId:owner(),generation:bigint("generation",{mode:"number"}).notNull().default(1),
  queued_at:timestamp("queued_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[foreignKey({columns:[t.userId,t.memory_id],foreignColumns:[memoriesTable.userId,memoriesTable.id]}).onDelete("cascade")]);
export const notificationsTable=pgTable("notifications",{
  id:uuid("id").primaryKey().defaultRandom(),userId:owner(),memory_id:integer("memory_id"),reminder_id:uuid("reminder_id"),
  title:text("title").notNull(),body:text("body").notNull(),url:text("url").notNull(),kind:text("kind").notNull(),
  read:boolean("read").notNull().default(false),created_at:created(),delivery_status:text("delivery_status").notNull().default("claimed"),
  delivered_devices:integer("delivered_devices").notNull().default(0),
},t=>[foreignKey({columns:[t.userId,t.memory_id],foreignColumns:[memoriesTable.userId,memoriesTable.id]}).onDelete("cascade"),
  index("notifications_owner").on(t.userId,t.created_at)]);
export const notificationDailyLedgerTable=pgTable("notification_daily_ledger",{
  userId:owner(),local_day:date("local_day").notNull(),used:integer("used").notNull().default(0),
  summary_sent:boolean("summary_sent").notNull().default(false),brief_claimed:boolean("brief_claimed").notNull().default(false),
  suggestion_claimed:boolean("suggestion_claimed").notNull().default(false),overflow_count:integer("overflow_count").notNull().default(0),
},t=>[primaryKey({columns:[t.userId,t.local_day]})]);
export const notificationSuggestionClaimsTable=pgTable("notification_suggestion_claims",{
  userId:owner(),fingerprint:text("fingerprint").notNull(),claimed_at:timestamp("claimed_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.userId,t.fingerprint]})]);
export const notificationMigrationStateTable=pgTable("notification_migration_state",{
  key:text("key").primaryKey(),applied_at:timestamp("applied_at",{withTimezone:true}).notNull().defaultNow(),
});