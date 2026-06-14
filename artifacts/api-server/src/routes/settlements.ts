import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, settlementsTable } from "@workspace/db";
import {
  CreateSettlementBody,
  CreateSettlementParams,
  ListSettlementsParams,
  DeleteSettlementParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseAmount(val: unknown): number {
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "number") return val;
  return 0;
}

router.get("/groups/:groupId/settlements", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);

  const rows = await db
    .select({
      id: settlementsTable.id,
      groupId: settlementsTable.groupId,
      fromUserId: settlementsTable.fromUserId,
      toUserId: settlementsTable.toUserId,
      amount: settlementsTable.amount,
      date: settlementsTable.date,
      notes: settlementsTable.notes,
      createdAt: settlementsTable.createdAt,
      fromName: usersTable.name,
    })
    .from(settlementsTable)
    .leftJoin(usersTable, eq(settlementsTable.fromUserId, usersTable.id))
    .where(eq(settlementsTable.groupId, groupId))
    .orderBy(desc(settlementsTable.date));

  // Get "to" user names
  const result = [];
  for (const row of rows) {
    const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, row.toUserId)).limit(1);
    result.push({
      id: row.id,
      groupId: row.groupId,
      fromUserId: row.fromUserId,
      fromUserName: row.fromName ?? "Unknown",
      toUserId: row.toUserId,
      toUserName: toUser?.name ?? "Unknown",
      amount: parseAmount(row.amount),
      date: row.date,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  }
  res.json(result);
});

router.post("/groups/:groupId/settlements", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const parsed = CreateSettlementBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [settlement] = await db.insert(settlementsTable).values({
    groupId,
    fromUserId: parsed.data.fromUserId,
    toUserId: parsed.data.toUserId,
    amount: parsed.data.amount.toString(),
    date: parsed.data.date,
    notes: parsed.data.notes,
  }).returning();

  const [fromUser] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.fromUserId)).limit(1);
  const [toUser] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.toUserId)).limit(1);

  res.status(201).json({
    ...settlement,
    amount: parseAmount(settlement!.amount),
    fromUserName: fromUser?.name ?? "Unknown",
    toUserName: toUser?.name ?? "Unknown",
  });
});

router.delete("/settlements/:settlementId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.settlementId) ? req.params.settlementId[0] : req.params.settlementId;
  const settlementId = parseInt(raw!, 10);
  await db.delete(settlementsTable).where(eq(settlementsTable.id, settlementId));
  res.status(204).send();
});

export default router;
