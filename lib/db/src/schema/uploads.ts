import { integer, pgTable, text, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const uploadsTable = pgTable("uploads", {
  path: text("path").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  name: varchar("name", { length: 255 }).notNull(),
  size: integer("size").notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
});