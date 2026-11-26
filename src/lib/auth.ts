import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { isUuid, sanitizeNextPath } from "@/lib/url";

export const getCurrentUser = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!isUuid(userId)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
});

export async function requireUser(nextPath?: string) {
  const user = await getCurrentUser();
  if (!user) {
    const safeNext = sanitizeNextPath(nextPath);
    redirect(safeNext === "/" ? "/login" : `/login?next=${encodeURIComponent(safeNext)}`);
  }
  return user;
}

export async function listActiveSessions(userId: string) {
  return db
    .select({ expires: sessions.expires })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expires, new Date())));
}

export async function revokeAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function destroySession() {
  await signOut({ redirect: false });
}
