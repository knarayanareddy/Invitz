"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { follows, notifications, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export async function toggleFollow(formData: FormData) {
  const me = await requireUser();
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  if (!handle) return;
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1);
  if (!target || target.id === me.id) return;
  const [existing] = await db
    .select()
    .from(follows)
    .where(and(eq(follows.followerId, me.id), eq(follows.followeeId, target.id)))
    .limit(1);
  if (existing) {
    await db.delete(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, target.id)));
  } else {
    await db.insert(follows).values({ followerId: me.id, followeeId: target.id, notify: true });
  }
  revalidatePath(`/people/${handle}`);
  revalidatePath("/people");
  revalidatePath("/onboarding");
}

/** The "bell": get notified when this person shares. */
export async function toggleBell(formData: FormData) {
  const me = await requireUser();
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  if (!handle) return;
  const notify = formData.get("notify") === "true";
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1);
  if (!target) return;
  await db
    .update(follows)
    .set({ notify: !notify })
    .where(and(eq(follows.followerId, me.id), eq(follows.followeeId, target.id)));
  revalidatePath(`/people/${handle}`);
}

export async function markAllRead() {
  const me = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me.id), eq(notifications.channel, "in_app")));
  revalidatePath("/", "layout");
}
