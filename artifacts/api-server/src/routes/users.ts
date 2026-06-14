import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/users/me", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (existing.length > 0) {
    res.json(existing[0]);
    return;
  }

  // Auto-create user from Clerk data
  const clerkUser = (req as any).auth?.sessionClaims ?? {};
  const name = (clerkUser.name as string) || (clerkUser.email as string)?.split("@")[0] || "Unknown";
  const email = (clerkUser.email as string) || "";

  const [newUser] = await db.insert(usersTable).values({ clerkId, name, email }).returning();
  logger.info({ userId: newUser.id }, "Created new user");
  res.json(newUser);
});

router.get("/users", async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(users);
});

export default router;
