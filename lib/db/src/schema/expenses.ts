import { pgTable, text, serial, timestamp, integer, numeric, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { groupsTable } from "./groups";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groupsTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  amountInr: numeric("amount_inr", { precision: 12, scale: 2 }).notNull(),
  splitType: text("split_type").notNull().default("equal"),
  date: date("date", { mode: "string" }).notNull(),
  paidByUserId: integer("paid_by_user_id").references(() => usersTable.id),
  notes: text("notes"),
  isSettlement: boolean("is_settlement").notNull().default(false),
  importedFromSession: integer("imported_from_session"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const expenseSplitsTable = pgTable("expense_splits", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id").notNull().references(() => expensesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  amountOwed: numeric("amount_owed", { precision: 12, scale: 2 }).notNull(),
  shareCount: numeric("share_count", { precision: 8, scale: 2 }),
  percentage: numeric("percentage", { precision: 8, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inserExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExpense = z.infer<typeof inserExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;

export const insertExpenseSplitSchema = createInsertSchema(expenseSplitsTable).omit({ id: true, createdAt: true });
export type InsertExpenseSplit = z.infer<typeof insertExpenseSplitSchema>;
export type ExpenseSplit = typeof expenseSplitsTable.$inferSelect;
