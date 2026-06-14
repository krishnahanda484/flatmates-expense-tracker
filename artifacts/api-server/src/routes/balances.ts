import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, expensesTable, expenseSplitsTable, settlementsTable, membershipsTable } from "@workspace/db";

const router: IRouter = Router();

function parseNum(val: unknown): number {
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "number") return val;
  return 0;
}

async function computeBalances(groupId: number) {
  // Get all active members
  const memberships = await db.select({
    userId: membershipsTable.userId,
    userName: usersTable.name,
  })
    .from(membershipsTable)
    .leftJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(eq(membershipsTable.groupId, groupId));

  const userIds = [...new Set(memberships.map(m => m.userId))];
  const userNames: Record<number, string> = {};
  for (const m of memberships) {
    userNames[m.userId] = m.userName ?? "Unknown";
  }

  // totalPaid[userId] = total INR paid by user
  const paidMap: Record<number, number> = {};
  // owedMap[userId] = total INR owed by user
  const owedMap: Record<number, number> = {};

  for (const uid of userIds) {
    paidMap[uid] = 0;
    owedMap[uid] = 0;
  }

  // Expenses paid
  const expenses = await db.select().from(expensesTable).where(eq(expensesTable.groupId, groupId));
  for (const expense of expenses) {
    if (expense.isSettlement) continue;
    const amtInr = parseNum(expense.amountInr);
    if (expense.paidByUserId && paidMap[expense.paidByUserId] !== undefined) {
      paidMap[expense.paidByUserId]! += amtInr;
    }
  }

  // Splits (how much each person owes)
  const allSplits = await db
    .select({ expenseId: expenseSplitsTable.expenseId, userId: expenseSplitsTable.userId, amountOwed: expenseSplitsTable.amountOwed })
    .from(expenseSplitsTable);

  const expenseIds = new Set(expenses.filter(e => !e.isSettlement).map(e => e.id));
  for (const split of allSplits) {
    if (!expenseIds.has(split.expenseId)) continue;
    if (owedMap[split.userId] !== undefined) {
      owedMap[split.userId]! += parseNum(split.amountOwed);
    }
  }

  // Settlements: fromUser paid toUser → reduces fromUser's debt, reduces toUser's credit
  const settlements = await db.select().from(settlementsTable).where(eq(settlementsTable.groupId, groupId));
  const settledByFrom: Record<number, number> = {};
  const settledByTo: Record<number, number> = {};
  for (const uid of userIds) {
    settledByFrom[uid] = 0;
    settledByTo[uid] = 0;
  }
  for (const s of settlements) {
    const amt = parseNum(s.amount);
    if (settledByFrom[s.fromUserId] !== undefined) settledByFrom[s.fromUserId]! += amt;
    if (settledByTo[s.toUserId] !== undefined) settledByTo[s.toUserId]! += amt;
  }

  const members = userIds.map(uid => {
    const paid = (paidMap[uid] ?? 0) + (settledByFrom[uid] ?? 0);
    const owed = (owedMap[uid] ?? 0) + (settledByTo[uid] ?? 0);
    return {
      userId: uid,
      userName: userNames[uid] ?? "Unknown",
      totalPaid: Math.round(paid * 100) / 100,
      totalOwed: Math.round(owed * 100) / 100,
      netBalance: Math.round((paid - owed) * 100) / 100,
    };
  });

  const totalSpend = expenses.filter(e => !e.isSettlement).reduce((s, e) => s + parseNum(e.amountInr), 0);
  return { members, totalSpend: Math.round(totalSpend * 100) / 100, currency: "INR" };
}

// Balances
router.get("/groups/:groupId/balances", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const summary = await computeBalances(groupId);
  res.json(summary);
});

// Suggested settlements (minimum transactions algorithm)
router.get("/groups/:groupId/settlements/suggested", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const { members } = await computeBalances(groupId);

  // Minimum transactions: debtors pay creditors
  const debtors = members.filter(m => m.netBalance < -0.01).map(m => ({ ...m, balance: m.netBalance }));
  const creditors = members.filter(m => m.netBalance > 0.01).map(m => ({ ...m, balance: m.netBalance }));

  const suggestions: { fromUserId: number; fromUserName: string; toUserId: number; toUserName: string; amount: number }[] = [];

  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const amount = Math.min(Math.abs(debtor.balance), creditor.balance);
    if (amount > 0.01) {
      suggestions.push({
        fromUserId: debtor.userId,
        fromUserName: debtor.userName,
        toUserId: creditor.userId,
        toUserName: creditor.userName,
        amount: Math.round(amount * 100) / 100,
      });
    }
    debtor.balance += amount;
    creditor.balance -= amount;
    if (Math.abs(debtor.balance) < 0.01) i++;
    if (creditor.balance < 0.01) j++;
  }

  res.json(suggestions);
});

// Group stats
router.get("/groups/:groupId/stats", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const { members, totalSpend } = await computeBalances(groupId);

  const settlements = await db.select().from(settlementsTable).where(eq(settlementsTable.groupId, groupId));
  const totalSettled = settlements.reduce((s, st) => s + parseNum(st.amount), 0);

  const expenses = await db.select().from(expensesTable).where(eq(expensesTable.groupId, groupId));
  const expenseCount = expenses.filter(e => !e.isSettlement).length;

  const memberStats = members.map(m => ({
    userId: m.userId,
    userName: m.userName,
    totalPaid: m.totalPaid,
    shareOwed: m.totalOwed,
    netBalance: m.netBalance,
  }));

  res.json({
    totalSpend,
    totalSettled: Math.round(totalSettled * 100) / 100,
    outstandingDebt: Math.round(members.filter(m => m.netBalance < 0).reduce((s, m) => s + Math.abs(m.netBalance), 0) * 100) / 100,
    expenseCount,
    memberStats,
  });
});

// Activity feed
router.get("/groups/:groupId/activity", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);

  const expenses = await db.select().from(expensesTable)
    .where(eq(expensesTable.groupId, groupId))
    .orderBy(desc(expensesTable.date))
    .limit(20);

  const settlements = await db.select().from(settlementsTable)
    .where(eq(settlementsTable.groupId, groupId))
    .orderBy(desc(settlementsTable.date))
    .limit(10);

  const activity: any[] = [];

  for (const e of expenses) {
    const paidBy = e.paidByUserId
      ? await db.select().from(usersTable).where(eq(usersTable.id, e.paidByUserId)).limit(1).then(r => r[0])
      : null;
    activity.push({
      id: `exp_${e.id}`,
      type: e.isSettlement ? "settlement" : "expense",
      description: e.description,
      date: e.date,
      userName: paidBy?.name ?? "Unknown",
      amount: parseNum(e.amountInr),
      currency: e.currency,
    });
  }

  for (const s of settlements) {
    const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, s.fromUserId)).limit(1);
    const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, s.toUserId)).limit(1);
    activity.push({
      id: `set_${s.id}`,
      type: "settlement",
      description: `${fromUser?.name ?? "?"} paid ${toUser?.name ?? "?"}`,
      date: s.date,
      userName: fromUser?.name ?? "Unknown",
      amount: parseNum(s.amount),
      currency: "INR",
    });
  }

  activity.sort((a, b) => b.date.localeCompare(a.date));
  res.json(activity.slice(0, 25));
});

export default router;
