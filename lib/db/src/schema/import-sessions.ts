import { pgTable, serial, timestamp, integer, text, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { groupsTable } from "./groups";

export const importSessionsTable = pgTable("import_sessions", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  groupId: integer("group_id").notNull().references(() => groupsTable.id),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  issueCount: integer("issue_count").notNull().default(0),
  issues: jsonb("issues").notNull().default([]),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportSessionSchema = createInsertSchema(importSessionsTable).omit({ id: true, importedAt: true });
export type InsertImportSession = z.infer<typeof insertImportSessionSchema>;
export type ImportSession = typeof importSessionsTable.$inferSelect;
