import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  follows,
  groupMembers,
  groups,
  inviteGroups,
  invites,
  notificationChannels,
  notifications,
  users,
} from "@/db/schema";
import { appUrl, formatWhen } from "@/lib/format";
import { getAdapter } from "./adapters";

/**
 * Fan-out: invite -> audience -> notifications (+ external deliveries).
 *
 * Audience = (unmuted members of every target group)
 *          ∪ (followers with the bell on IF they have permission to view this invite),
 *          minus the sharer.
 * One user gets ONE in-app row plus one row per verified+enabled channel, no matter how many
 * rules matched them (deduplicated).
 *
 * Runs asynchronously after the response (`after()`).
 * Scale-out path: enqueue a job per invite and per delivery (see docs/phases/phase-4).
 */
export async function fanOutInvite(inviteId: string) {
  const [row] = await db
    .select({
      id: invites.id,
      status: invites.status,
      verdict: invites.verdict,
      note: invites.note,
      sharerId: users.id,
      sharerHandle: users.handle,
      title: events.title,
      startsAt: events.startsAt,
      location: events.location,
      eventUrl: events.url,
    })
    .from(invites)
    .innerJoin(events, eq(events.id, invites.eventId))
    .innerJoin(users, eq(users.id, invites.sharedById))
    .where(eq(invites.id, inviteId))
    .limit(1);
  if (!row || row.status !== "published") return;

  const targets = await db
    .select({ id: groups.id, name: groups.name, visibility: groups.visibility })
    .from(inviteGroups)
    .innerJoin(groups, eq(groups.id, inviteGroups.groupId))
    .where(eq(inviteGroups.inviteId, inviteId));

  if (targets.length === 0) return;

  const hasPublicGroup = targets.some((t) => t.visibility === "public");
  const targetGroupIds = targets.map((t) => t.id);

  // Load ALL members of target groups (including muted) so we know who can access private invites.
  const allMembers = await db
    .select({ userId: groupMembers.userId, groupId: groupMembers.groupId, muted: groupMembers.muted })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, targetGroupIds));

  const memberIds = new Set(allMembers.map((m) => m.userId));
  const reasons = new Map<string, string[]>();
  const addReason = (userId: string, reason: string) => {
    if (userId === row.sharerId) return;
    const list = reasons.get(userId) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(userId, list);
  };

  const names = new Map(targets.map((t) => [t.id, t.name]));
  for (const m of allMembers) {
    if (!m.muted) {
      addReason(m.userId, `Shared in ${names.get(m.groupId)}`);
    }
  }

  const followers = await db
    .select({ id: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followeeId, row.sharerId), eq(follows.notify, true)));

  for (const f of followers) {
    // CRITICAL: Never leak private-group invites to non-member followers.
    if (!hasPublicGroup && !memberIds.has(f.id)) continue;
    addReason(f.id, `You follow @${row.sharerHandle}`);
  }

  const userIds = [...reasons.keys()];
  if (userIds.length === 0) return;

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        inArray(notificationChannels.userId, userIds),
        eq(notificationChannels.enabled, true),
        eq(notificationChannels.verified, true),
      ),
    );

  const now = new Date();
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const userId of userIds) {
    const reason = (reasons.get(userId) ?? []).slice(0, 2).join(" · ");
    rows.push({ userId, inviteId, channel: "in_app", reason, status: "sent", sentAt: now });
  }
  for (const ch of channels) {
    if (row.verdict !== "verified" && !ch.includeUnverified) continue; // unverified invites never push by default
    rows.push({
      userId: ch.userId,
      inviteId,
      channel: ch.type,
      channelId: ch.id,
      reason: (reasons.get(ch.userId) ?? []).slice(0, 2).join(" · "),
      status: "pending",
    });
  }

  // Insert in chunks to stay well below Postgres's 65,535 bind-parameter ceiling, and keep idempotent.
  const inserted: (typeof notifications.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = await db.insert(notifications).values(rows.slice(i, i + 500)).onConflictDoNothing().returning();
    inserted.push(...chunk);
  }

  const channelById = new Map(channels.map((c) => [c.id, c]));
  const when = formatWhen(row.startsAt);
  const caution = row.verdict === "caution";

  const send = async (n: (typeof inserted)[number]) => {
    const ch = n.channelId ? channelById.get(n.channelId) : undefined;
    if (!ch) return;
    const adapter = getAdapter(ch.type);
    if (!adapter) return;

    // Never push live external messages to destinations that were only verified in dry-run mode.
    if (ch.verifiedDryRun && adapter.configured()) {
      await db
        .update(notifications)
        .set({
          status: "skipped",
          error: "Verified in dry-run mode only; re-verify channel to enable live delivery.",
        })
        .where(eq(notifications.id, n.id));
      return;
    }

    const result = await adapter.send(ch.destination, {
      kind: "invite",
      title: `${caution ? "⚠️" : "✅"} ${row.title}`,
      text: [
        [when, row.location].filter(Boolean).join(" · "),
        row.note ? `“${row.note}”` : "",
        `Shared by @${row.sharerHandle} — ${n.reason}`,
        caution ? "⚠️ Invitz could not verify this invite. It might be spam — proceed with caution." : "",
        `Event: ${row.eventUrl.slice(0, 500)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      url: `${appUrl()}/invites/${inviteId}`,
    });

    await db
      .update(notifications)
      .set({
        status: result.ok ? (result.dryRun ? "dry_run" : "sent") : "failed",
        attempts: n.attempts + 1,
        error: result.error ?? null,
        sentAt: result.ok ? new Date() : null,
      })
      .where(eq(notifications.id, n.id));
  };

  const pending = inserted.filter((n) => n.status === "pending");
  for (let i = 0; i < pending.length; i += 5) {
    await Promise.allSettled(pending.slice(i, i + 5).map(send));
  }
}

/** Sends the one-time verification code through the channel itself (proves ownership). */
export async function sendVerificationCode(channelId: string) {
  const [ch] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, channelId)).limit(1);
  if (!ch) return { ok: false, error: "Channel not found" };
  const adapter = getAdapter(ch.type);
  if (!adapter) return { ok: false, error: "Unknown channel type" };

  const code = String(randomInt(100000, 1000000));
  await db
    .update(notificationChannels)
    .set({
      verifyCode: code,
      verifyExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      verifyAttempts: 0,
      verifyLockedUntil: null,
    })
    .where(eq(notificationChannels.id, channelId));

  return adapter.send(ch.destination, {
    kind: "verify",
    verifyCode: code,
    title: "Invitz verification code",
    text: `Your code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this message.`,
    url: appUrl(),
  });
}
