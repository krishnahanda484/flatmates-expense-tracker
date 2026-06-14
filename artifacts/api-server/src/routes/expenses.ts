import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, expensesTable, expenseSplitsTable, exchangeRatesTable } from "@workspace/db";
import {
  CreateExpenseBody,
  CreateExpenseParams,
  GetExpenseParams,
  UpdateExpenseParams,
  UpdateExpenseBody,
  DeleteExpenseParams,
  ListExpensesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getUsdToInr(): Promise<number> {
  const rates = await db.select().from(exchangeRatesTable)
    .where(eq(exchangeRatesTable.fromCurrency, "USD"))
    .orderBy(desc(exchangeRatesTable.effectiveDate))
    .limit(1);
  return rates[0] ? parseFloat(rates[0].rate as string) : 84;
}

function parseAmount(val: unknown): number {
  if (typeof val === "string") return parseFloat(val.replace(/,/g, "")) || 0;
  if (typeof val === "number") return val;
  return 0;
}

async function buildExpenseResponse(expense: typeof expensesTable.$inferSelect) {
  const paidBy = expense.paidByUserId
    ? await db.select().from(usersTable).where(eq(usersTable.id, expense.paidByUserId)).limit(1).then(r => r[0])
    : null;
  return {
    ...expense,
    amount: parseAmount(expense.amount),
    amountInr: parseAmount(expense.amountInr),
    paidByName: paidBy?.name ?? "Unknown",
  };
}

async function buildExpenseDetailResponse(expense: typeof expensesTable.$inferSelect) {
  const base = await buildExpenseResponse(expense);
  const splitRows = await db
    .select({
      id: expenseSplitsTable.id,
      expenseId: expenseSplitsTable.expenseId,
      userId: expenseSplitsTable.userId,
      userName: usersTable.name,
      amountOwed: expenseSplitsTable.amountOwed,
      shareCount: expenseSplitsTable.shareCount,
      percentage: expenseSplitsTable.percentage,
    })
    .from(expenseSplitsTable)
    .leftJoin(usersTable, eq(expenseSplitsTable.userId, usersTable.id))
    .where(eq(expenseSplitsTable.expenseId, expense.id));

  return {
    ...base,
    splits: splitRows.map(s => ({
      ...s,
      amountOwed: parseAmount(s.amountOwed),
      shareCount: s.shareCount ? parseAmount(s.shareCount) : null,
      percentage: s.percentage ? parseAmount(s.percentage) : null,
    })),
  };
}

router.get("/groups/:groupId/expenses", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);

  const expenses = await db.select().from(expensesTable)
    .where(eq(expensesTable.groupId, groupId))
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));

  const result = await Promise.all(expenses.map(buildExpenseResponse));
  res.json(result);
});

router.post("/groups/:groupId/expenses", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { description, amount, currency, splitType, date, paidByUserId, notes, isSettlement, splits } = parsed.data;
  const usdRate = await getUsdToInr();
  const amountInr = currency === "USD" ? amount * usdRate : amount;

  const [expense] = await db.insert(expensesTable).values({
    groupId,
    description,
    amount: amount.toString(),
    currency: currency || "INR",
    amountInr: amountInr.toString(),
    splitType: splitType || "equal",
    date,
    paidByUserId,
    notes,
    isSettlement: isSettlement ?? false,
  }).returning();

  // Create splits
  if (splits && splits.length > 0) {
    for (const split of splits) {
      await db.insert(expenseSplitsTable).values({
        expenseId: expense!.id,
        userId: split.userId,
        amountOwed: split.amountOwed.toString(),
        shareCount: split.shareCount?.toString(),
        percentage: split.percentage?.toString(),
      });
    }
  }

  const result = await buildExpenseResponse(expense!);
  res.status(201).json(result);
});

router.get("/expenses/:expenseId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.expenseId) ? req.params.expenseId[0] : req.params.expenseId;
  const expenseId = parseInt(raw!, 10);

  const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.id, expenseId)).limit(1);
  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

  const result = await buildExpenseDetailResponse(expense);
  res.json(result);
});

router.patch("/expenses/:expenseId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.expenseId) ? req.params.expenseId[0] : req.params.expenseId;
  const expenseId = parseInt(raw!, 10);
  const parsed = UpdateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { splits, amount, currency, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };

  if (amount !== undefined && currency !== undefined) {
    const usdRate = await getUsdToInr();
    updates.amount = amount.toString();
    updates.currency = currency;
    updates.amountInr = (currency === "USD" ? amount * usdRate : amount).toString();
  }

  const [updated] = await db.update(expensesTable).set(updates as any).where(eq(expensesTable.id, expenseId)).returning();
  if (!updated) { res.status(404).json({ error: "Expense not found" }); return; }

  if (splits && splits.length > 0) {
    await db.delete(expenseSplitsTable).where(eq(expenseSplitsTable.expenseId, expenseId));
    for (const split of splits) {
      await db.insert(expenseSplitsTable).values({
        expenseId,
        userId: split.userId,
        amountOwed: split.amountOwed.toString(),
        shareCount: split.shareCount?.toString(),
        percentage: split.percentage?.toString(),
      });
    }
  }

  const result = await buildExpenseResponse(updated);
  res.json(result);
});

router.delete("/expenses/:expenseId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.expenseId) ? req.params.expenseId[0] : req.params.expenseId;
  const expenseId = parseInt(raw!, 10);
  await db.delete(expenseSplitsTable).where(eq(expenseSplitsTable.expenseId, expenseId));
  await db.delete(expensesTable).where(eq(expensesTable.id, expenseId));
  res.status(204).send();
});

export default router;
