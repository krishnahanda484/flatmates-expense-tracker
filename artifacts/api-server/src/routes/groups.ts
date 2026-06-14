import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable, groupsTable, membershipsTable } from "@workspace/db";
import {
  CreateGroupBody,
  UpdateGroupBody,
  UpdateGroupParams,
  DeleteGroupParams,
  GetGroupParams,
  AddGroupMemberBody,
  AddGroupMemberParams,
  UpdateGroupMemberParams,
  UpdateGroupMemberBody,
  RemoveGroupMemberParams,
  ListGroupMembersParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getCurrentUser(clerkId: string) {
  const users = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  return users[0] ?? null;
}

async function getMembershipsWithNames(groupId: number) {
  const rows = await db
    .select({
      id: membershipsTable.id,
      groupId: membershipsTable.groupId,
      userId: membershipsTable.userId,
      userName: usersTable.name,
      userEmail: usersTable.email,
      joinedAt: membershipsTable.joinedAt,
      leftAt: membershipsTable.leftAt,
    })
    .from(membershipsTable)
    .leftJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(eq(membershipsTable.groupId, groupId))
    .orderBy(membershipsTable.joinedAt);
  return rows.map((r) => ({ ...r, isActive: !r.leftAt }));
}

// List groups for current user
router.get("/groups", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getCurrentUser(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const memberRows = await db
    .select({ groupId: membershipsTable.groupId })
    .from(membershipsTable)
    .where(and(eq(membershipsTable.userId, user.id), isNull(membershipsTable.leftAt)));

  const groupIds = memberRows.map((r) => r.groupId);
  if (groupIds.length === 0) { res.json([]); return; }

  const groups = await db.select().from(groupsTable).where(
    groupIds.length === 1
      ? eq(groupsTable.id, groupIds[0]!)
      : eq(groupsTable.id, groupIds[0]!)
  );

  // Actually fetch all groups the user is in
  const allGroups = [];
  for (const gid of groupIds) {
    const g = await db.select().from(groupsTable).where(eq(groupsTable.id, gid)).limit(1);
    if (g[0]) allGroups.push(g[0]);
  }
  res.json(allGroups);
});

// Create group
router.post("/groups", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getCurrentUser(clerkId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [group] = await db.insert(groupsTable).values({ name: parsed.data.name, createdByUserId: user.id }).returning();

  // Add creator as first member
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(membershipsTable).values({ groupId: group!.id, userId: user.id, joinedAt: today });

  // Add any extra members by name (create ghost users)
  const memberNames = parsed.data.memberNames ?? [];
  for (const name of memberNames) {
    if (!name.trim()) continue;
    // Check if user with this name exists
    let targetUser = await db.select().from(usersTable).where(eq(usersTable.name, name.trim())).limit(1).then(r => r[0]);
    if (!targetUser) {
      const [nu] = await db.insert(usersTable).values({ clerkId: `ghost_${Date.now()}_${Math.random()}`, name: name.trim(), email: "" }).returning();
      targetUser = nu!;
    }
    if (targetUser.id !== user.id) {
      await db.insert(membershipsTable).values({ groupId: group!.id, userId: targetUser.id, joinedAt: today });
    }
  }

  res.status(201).json(group);
});

// Get group detail
router.get("/groups/:groupId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  if (isNaN(groupId)) { res.status(400).json({ error: "Invalid groupId" }); return; }

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = await getMembershipsWithNames(groupId);
  res.json({ ...group, members });
});

// Update group
router.patch("/groups/:groupId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(groupsTable).set({ name: parsed.data.name! }).where(eq(groupsTable.id, groupId)).returning();
  if (!updated) { res.status(404).json({ error: "Group not found" }); return; }
  res.json(updated);
});

// Delete group
router.delete("/groups/:groupId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  await db.delete(groupsTable).where(eq(groupsTable.id, groupId));
  res.status(204).send();
});

// List members
router.get("/groups/:groupId/members", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const members = await getMembershipsWithNames(groupId);
  res.json(members);
});

// Add member
router.post("/groups/:groupId/members", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
  const groupId = parseInt(raw!, 10);
  const parsed = AddGroupMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let userId = parsed.data.userId;

  // If userId is 0 or not found, create ghost user from name
  if (!userId && parsed.data.userName) {
    let targetUser = await db.select().from(usersTable).where(eq(usersTable.name, parsed.data.userName)).limit(1).then(r => r[0]);
    if (!targetUser) {
      const [nu] = await db.insert(usersTable).values({ clerkId: `ghost_${Date.now()}`, name: parsed.data.userName, email: "" }).returning();
      targetUser = nu!;
    }
    userId = targetUser.id;
  }

  const [membership] = await db.insert(membershipsTable).values({
    groupId,
    userId,
    joinedAt: parsed.data.joinedAt,
  }).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.status(201).json({
    ...membership,
    userName: user?.name ?? "",
    userEmail: user?.email ?? "",
    isActive: !membership!.leftAt,
  });
});

// Update member
router.patch("/groups/:groupId/members/:membershipId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawM = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
  const membershipId = parseInt(rawM!, 10);
  const parsed = UpdateGroupMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: Record<string, unknown> = {};
  if (parsed.data.leftAt !== undefined) updates.leftAt = parsed.data.leftAt;
  if (parsed.data.joinedAt !== undefined) updates.joinedAt = parsed.data.joinedAt;

  const [updated] = await db.update(membershipsTable).set(updates as any).where(eq(membershipsTable.id, membershipId)).returning();
  if (!updated) { res.status(404).json({ error: "Membership not found" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId)).limit(1);
  res.json({ ...updated, userName: user?.name ?? "", userEmail: user?.email ?? "", isActive: !updated.leftAt });
});

// Remove member
router.delete("/groups/:groupId/members/:membershipId", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawM = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
  const membershipId = parseInt(rawM!, 10);
  await db.delete(membershipsTable).where(eq(membershipsTable.id, membershipId));
  res.status(204).send();
});

export default router;
