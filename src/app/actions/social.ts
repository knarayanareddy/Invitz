"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { follows, notificationChannels, notifications, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { deliverNotificationNow } from "@/lib/notify/dispatch";
import { publishBellUpdate } from "@/lib/notify/realtime";
import { isUuid } from "@/lib/url";

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
  const now = new Date();
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, me.id), eq(notifications.channel, "in_app")));
  await publishBellUpdate({ userId: me.id, unreadCount: 0, kind: "read", at: now.toISOString() });
  revalidatePath("/", "layout");
}

export async function markOneRead(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("notificationId") ?? "");
  if (!isUuid(id)) return;
  const now = new Date();
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.userId, me.id), eq(notifications.channel, "in_app")));

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), eq(notifications.channel, "in_app"), sql`${notifications.readAt} is null`));

  await publishBellUpdate({ userId: me.id, notificationId: id, unreadCount: unread, kind: "read", at: now.toISOString() });
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function retryNotificationDelivery(formData: FormData) {
  const me = await requireUser("/notifications");
  const id = String(formData.get("notificationId") ?? "");
  if (!isUuid(id)) return;

  const [n] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, me.id), ne(notifications.channel, "in_app")))
    .limit(1);
  if (!n || !["failed", "dead_letter"].includes(n.status)) return;

  // If the channel was paused by failures and user explicitly retries, give it a clean re-try attempt.
  if (n.channelId) {
    await db
      .update(notificationChannels)
      .set({ enabled: true, failureCount: 0, disabledReason: null })
      .where(and(eq(notificationChannels.id, n.channelId), eq(notificationChannels.userId, me.id)));
  }

  await deliverNotificationNow(n.id, { allowRetryOfFailedOrDlq: true });
  revalidatePath("/notifications");
  revalidatePath("/settings");
}

export async function discardNotificationDelivery(formData: FormData) {
  const me = await requireUser("/notifications");
  const id = String(formData.get("notificationId") ?? "");
  if (!isUuid(id)) return;

  await db
    .update(notifications)
    .set({ status: "skipped", error: "Discarded from delivery queue by user.", nextRetryAt: null })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, me.id),
        ne(notifications.channel, "in_app"),
        inArray(notifications.status, ["failed", "dead_letter", "queued", "pending"]),
      ),
    );
  revalidatePath("/notifications");
}
