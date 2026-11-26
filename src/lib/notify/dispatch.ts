import { randomBytes, randomInt } from "node:crypto";
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  discordGuildSubscriptions,
  events,
  follows,
  groupMembers,
  groups,
  inviteGroups,
  invites,
  notificationChannels,
  notificationPreferences,
  notifications,
  users,
  type ChannelType,
  type DigestMode,
  type Verdict,
} from "@/db/schema";
import { decryptSecret, hashVerifySecret, signUnsubscribeToken } from "@/lib/crypto";
import { appUrl, formatWhen } from "@/lib/format";
import { getAdapter, type OutboundMessage, type SendResult } from "./adapters";
import { enqueueDelivery, enqueueDigest, enqueueGuildDiscord } from "./queue";
import { publishBellUpdate } from "./realtime";
import { isWithinQuietHours, localDayStartUtc, nextDigestBucket, nextQuietHoursEndUtc } from "./schedule";

export const BACKOFF_SCHEDULE_MS = [30_000, 120_000, 600_000, 3_600_000] as const;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const PERMANENT_DISABLE_STRIKES = 5;
export const WHATSAPP_OPT_IN_CONSENT_TEXT =
  "I consent to receive event alerts and verification messages on WhatsApp from Invitz. Reply STOP at any time to unsubscribe.";

type InviteEnvelope = {
  id: string;
  status: string;
  verdict: Verdict;
  note: string | null;
  sharerId: string;
  sharerHandle: string;
  title: string;
  startsAt: Date | null;
  location: string | null;
  eventUrl: string;
};

function buildInviteMessage(row: InviteEnvelope, reason: string, unsubscribeUrl?: string): OutboundMessage {
  const when = formatWhen(row.startsAt);
  const caution = row.verdict === "caution";
  return {
    kind: "invite",
    caution,
    eventWhen: when || undefined,
    eventLocation: row.location || undefined,
    sharerHandle: row.sharerHandle,
    reason,
    eventUrl: row.eventUrl.slice(0, 500),
    unsubscribeUrl,
    title: `${caution ? "⚠️" : "✅"} ${row.title}`,
    text: [
      [when, row.location].filter(Boolean).join(" · "),
      row.note ? `“${row.note}”` : "",
      `Shared by @${row.sharerHandle} — ${reason}`,
      caution ? "⚠️ Invitz could not verify this invite. It might be spam — proceed with caution." : "",
      `Event: ${row.eventUrl.slice(0, 500)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    url: `${appUrl()}/invites/${row.id}`,
  };
}

/**
 * Fan-out: invite -> audience -> notifications (+ external deliveries / digests / Discord guild bots).
 *
 * Audience = (unmuted members of every target group)
 *          ∪ (followers with the bell on IF they have permission to view this invite),
 *          minus the sharer.
 * Priority rule: follow-bell invites from people you follow bypass digest batching (stay instant),
 * while community-only invites follow channel/user digest preferences; quiet hours defer both.
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
  const followBellUsers = new Set<string>();

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
    if (f.id !== row.sharerId) followBellUsers.add(f.id);
  }

  const userIds = [...reasons.keys()];

  const channels =
    userIds.length > 0
      ? await db
          .select()
          .from(notificationChannels)
          .where(
            and(
              inArray(notificationChannels.userId, userIds),
              eq(notificationChannels.enabled, true),
              eq(notificationChannels.verified, true),
            ),
          )
      : [];

  const prefRows =
    channels.length > 0
      ? await db
          .select()
          .from(notificationPreferences)
          .where(inArray(notificationPreferences.userId, userIds))
      : [];
  const prefsByUser = new Map(prefRows.map((p) => [p.userId, p]));

  const guildSubs = hasPublicGroup
    ? await db
        .select()
        .from(discordGuildSubscriptions)
        .where(
          inArray(
            discordGuildSubscriptions.groupId,
            targets.filter((t) => t.visibility === "public").map((t) => t.id),
          ),
        )
    : [];

  const now = new Date();
  const rows: (typeof notifications.$inferInsert)[] = [];
  for (const userId of userIds) {
    const reason = (reasons.get(userId) ?? []).slice(0, 2).join(" · ");
    rows.push({ userId, inviteId, channel: "in_app", reason, status: "sent", sentAt: now });
  }

  for (const ch of channels) {
    if (row.verdict !== "verified" && !ch.includeUnverified) continue;
    const prefs = prefsByUser.get(ch.userId);
    const tz = prefs?.timezone ?? "UTC";
    const quietStart = prefs?.quietStart ?? null;
    const quietEnd = prefs?.quietEnd ?? null;
    const isFollowBell = followBellUsers.has(ch.userId);
    const effectiveDigest: DigestMode = isFollowBell
      ? "instant"
      : ((ch.digestMode ?? prefs?.digestMode ?? "instant") as DigestMode);

    let status: "pending" | "queued" = "pending";
    let scheduledFor: Date | null = null;
    if (effectiveDigest !== "instant") {
      status = "queued";
      scheduledFor = nextDigestBucket(effectiveDigest, now, tz, quietStart, quietEnd);
    } else if (isWithinQuietHours(now, quietStart, quietEnd, tz)) {
      status = "pending";
      scheduledFor = nextQuietHoursEndUtc(now, quietStart, quietEnd, tz);
    }

    rows.push({
      userId: ch.userId,
      inviteId,
      channel: ch.type,
      channelId: ch.id,
      reason: (reasons.get(ch.userId) ?? []).slice(0, 2).join(" · "),
      status,
      scheduledFor,
    });
  }

  // Insert in chunks to stay well below Postgres's 65,535 bind-parameter ceiling, and keep idempotent.
  const inserted: (typeof notifications.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = await db.insert(notifications).values(rows.slice(i, i + 500)).onConflictDoNothing().returning();
    inserted.push(...chunk);
  }

  // Emit live bell updates for in-app recipients.
  await Promise.allSettled(
    inserted
      .filter((n) => n.channel === "in_app")
      .map((n) =>
        publishBellUpdate({
          userId: n.userId,
          notificationId: n.id,
          kind: "new",
          at: now.toISOString(),
        }),
      ),
  );

  const externalWorkerOnly = process.env.NOTIFY_USE_EXTERNAL_WORKER === "true";

  // Enqueue or immediately deliver external notifications.
  const immediatePending: (typeof inserted)[number][] = [];
  for (const n of inserted) {
    if (n.channel === "in_app") continue;
    if (n.status === "queued" && n.channelId) {
      await enqueueDigest(n.userId, n.channelId, n.scheduledFor ?? undefined).catch(() => undefined);
    } else if (n.status === "pending") {
      if (n.scheduledFor && n.scheduledFor.getTime() > now.getTime() + 1000) {
        await enqueueDelivery(n.id, n.scheduledFor).catch(() => undefined);
      } else if (externalWorkerOnly) {
        await enqueueDelivery(n.id).catch(() => undefined);
      } else {
        immediatePending.push(n);
      }
    }
  }

  for (let i = 0; i < immediatePending.length; i += 5) {
    await Promise.allSettled(immediatePending.slice(i, i + 5).map((n) => deliverNotificationNow(n.id)));
  }

  // Deliver or enqueue Discord server bot channel subscriptions for public communities.
  if (guildSubs.length > 0 && row.verdict === "verified") {
    for (const sub of guildSubs) {
      if (externalWorkerOnly) {
        await enqueueGuildDiscord(inviteId, sub.id).catch(() => undefined);
      } else {
        const gName = names.get(sub.groupId) ?? "Invitz community";
        await deliverGuildDiscordSubscription(inviteId, sub.id, gName).catch(() => undefined);
      }
    }
  }
}

export async function deliverGuildDiscordSubscription(inviteId: string, subscriptionId: string, groupName?: string) {
  if (!process.env.DISCORD_BOT_TOKEN || process.env.NOTIFY_DRY_RUN === "true") {
    return { ok: true, dryRun: true };
  }
  const [sub] = await db
    .select()
    .from(discordGuildSubscriptions)
    .where(eq(discordGuildSubscriptions.id, subscriptionId))
    .limit(1);
  if (!sub) return { ok: false, error: "Subscription removed" };

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
  if (!row || row.status !== "published") return { ok: false, error: "Invite unavailable" };

  const when = formatWhen(row.startsAt);
  const res = await fetch(`https://discord.com/api/v10/channels/${sub.channelId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `✅ ${row.title}`.slice(0, 250),
          url: `${appUrl()}/invites/${row.id}`,
          description: row.note ? `“${row.note.slice(0, 400)}”` : undefined,
          color: 0x2f6b4f,
          fields: [
            ...(when ? [{ name: "When", value: when, inline: true }] : []),
            ...(row.location ? [{ name: "Where", value: row.location.slice(0, 180), inline: true }] : []),
            { name: "Community", value: groupName ?? "Subscribed community", inline: true },
          ],
          footer: { text: `Shared by @${row.sharerHandle} · Invitz Bot` },
        },
      ],
    }),
  });

  if (res.status === 404 || res.status === 403 || res.status === 401) {
    await db.delete(discordGuildSubscriptions).where(eq(discordGuildSubscriptions.id, sub.id));
    return { ok: false, error: `Channel unavailable (${res.status}); subscription removed` };
  }
  return { ok: res.ok };
}

export async function deliverNotificationNow(
  notificationId: string,
  opts: { allowRetryOfFailedOrDlq?: boolean } = {},
): Promise<{ ok: boolean; status: string; error?: string }> {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!n) return { ok: false, status: "missing", error: "Notification not found" };
  if (n.channel === "in_app") return { ok: true, status: n.status };

  const allowedInitial = opts.allowRetryOfFailedOrDlq
    ? ["pending", "queued", "failed", "dead_letter"]
    : ["pending", "queued"];
  if (!allowedInitial.includes(n.status)) {
    return { ok: true, status: n.status };
  }

  if (!n.channelId) {
    await db
      .update(notifications)
      .set({ status: "skipped", error: "Channel deleted before delivery." })
      .where(eq(notifications.id, n.id));
    return { ok: false, status: "skipped" };
  }

  const [ch] = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, n.channelId))
    .limit(1);
  if (!ch || !ch.enabled) {
    await db
      .update(notifications)
      .set({ status: "skipped", error: ch ? ch.disabledReason ?? "Channel disabled." : "Channel deleted." })
      .where(eq(notifications.id, n.id));
    return { ok: false, status: "skipped" };
  }

  const adapter = getAdapter(ch.type);
  if (!adapter) {
    await db.update(notifications).set({ status: "skipped", error: "Unsupported adapter" }).where(eq(notifications.id, n.id));
    return { ok: false, status: "skipped" };
  }

  // Never push live external messages to destinations that were only verified in dry-run mode.
  if (ch.verifiedDryRun && adapter.configured()) {
    await db
      .update(notifications)
      .set({
        status: "skipped",
        error: "Verified in dry-run mode only; re-verify channel to enable live delivery.",
      })
      .where(eq(notifications.id, n.id));
    return { ok: false, status: "skipped" };
  }

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
    .where(eq(invites.id, n.inviteId))
    .limit(1);

  if (!row || row.status !== "published") {
    await db.update(notifications).set({ status: "skipped", error: "Invite no longer published." }).where(eq(notifications.id, n.id));
    return { ok: false, status: "skipped" };
  }

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, n.userId))
    .limit(1);

  const now = new Date();
  const tz = prefs?.timezone ?? "UTC";
  const dailyCap = prefs?.dailyCap ?? 5;

  // Enforce per-user external daily cap (unless dailyCap = 0 / unlimited)
  if (!opts.allowRetryOfFailedOrDlq && dailyCap > 0) {
    const dayStart = localDayStartUtc(now, tz);
    const [{ sentToday }] = await db
      .select({ sentToday: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, n.userId),
          ne(notifications.channel, "in_app"),
          inArray(notifications.status, ["sent", "dry_run"]),
          gte(notifications.sentAt, dayStart),
        ),
      );
    if (sentToday >= dailyCap) {
      const nextBucket = nextDigestBucket("daily", now, tz, prefs?.quietStart, prefs?.quietEnd);
      await db
        .update(notifications)
        .set({
          status: "queued",
          scheduledFor: nextBucket,
          error: `Daily limit (${dailyCap}) reached; rolled into next digest.`,
        })
        .where(eq(notifications.id, n.id));
      await enqueueDigest(n.userId, ch.id, nextBucket).catch(() => undefined);
      return { ok: true, status: "queued" };
    }
  }

  const plaintextDest = decryptSecret(ch.destination);
  const unsubscribeUrl =
    ch.type === "email"
      ? `${appUrl()}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(ch.id))}`
      : undefined;

  const message = buildInviteMessage(row, n.reason, unsubscribeUrl);
  const result = await adapter.send(plaintextDest, message);
  const newAttempts = n.attempts + 1;

  if (result.ok) {
    const nextStatus = result.dryRun ? "dry_run" : "sent";
    await db
      .update(notifications)
      .set({
        status: nextStatus,
        deliveryStatus: result.dryRun ? "dry_run" : "accepted",
        providerMessageId: result.providerMessageId ?? null,
        lastHttpStatus: result.statusCode ?? null,
        attempts: newAttempts,
        error: null,
        sentAt: now,
        nextRetryAt: null,
        deadLetteredAt: null,
      })
      .where(eq(notifications.id, n.id));

    if (ch.failureCount > 0 || ch.disabledReason) {
      await db
        .update(notificationChannels)
        .set({ failureCount: 0, disabledReason: null })
        .where(eq(notificationChannels.id, ch.id));
    }

    await publishBellUpdate({ userId: n.userId, notificationId: n.id, kind: "new", at: now.toISOString() });
    return { ok: true, status: nextStatus };
  }

  // Delivery failure handling
  return handleDeliveryFailure({
    notification: n,
    channel: ch,
    inviteRow: row,
    prefs: prefs ?? null,
    result,
    newAttempts,
    now,
    immediateManualRetry: Boolean(opts.allowRetryOfFailedOrDlq),
  });
}

async function handleDeliveryFailure(params: {
  notification: typeof notifications.$inferSelect;
  channel: typeof notificationChannels.$inferSelect;
  inviteRow: InviteEnvelope;
  prefs: typeof notificationPreferences.$inferSelect | null;
  result: SendResult;
  newAttempts: number;
  now: Date;
  immediateManualRetry: boolean;
}): Promise<{ ok: boolean; status: string; error?: string }> {
  const { notification: n, channel: ch, inviteRow, prefs, result, newAttempts, now, immediateManualRetry } = params;
  const statusCode = result.statusCode ?? null;
  const errMsg = result.error ?? "Delivery failed";

  if (result.permanentFailure) {
    const newFailures = ch.failureCount + 1;
    const isDiscordDeleted = ch.type === "discord" && (statusCode === 404 || statusCode === 401);
    const isTelegramBlocked = ch.type === "telegram" && statusCode === 403;
    const shouldDisable =
      isDiscordDeleted || Boolean(result.unregistered) || isTelegramBlocked || newFailures >= PERMANENT_DISABLE_STRIKES;

    const disableReason = isDiscordDeleted
      ? "Discord webhook returned 404/401 (deleted or revoked)."
      : result.unregistered
        ? "Signal number is not registered on Signal."
        : isTelegramBlocked
          ? "Telegram bot was blocked or chat no longer exists."
          : `Auto-disabled after ${newFailures} consecutive permanent delivery failures (${errMsg}).`;

    await db
      .update(notificationChannels)
      .set({
        failureCount: newFailures,
        ...(shouldDisable ? { enabled: false, disabledReason: disableReason } : {}),
      })
      .where(eq(notificationChannels.id, ch.id));

    const terminal = shouldDisable || newAttempts >= MAX_DELIVERY_ATTEMPTS;
    await db
      .update(notifications)
      .set({
        status: terminal ? "dead_letter" : "failed",
        deliveryStatus: "failed",
        lastHttpStatus: statusCode,
        attempts: newAttempts,
        error: errMsg,
        nextRetryAt: null,
        deadLetteredAt: terminal ? now : null,
      })
      .where(eq(notifications.id, n.id));

    if (terminal) {
      await triggerEmailFallback({ notification: n, inviteRow, prefs, failedChannel: ch.type, reasonError: errMsg });
    }
    return { ok: false, status: terminal ? "dead_letter" : "failed", error: errMsg };
  }

  // Transient error (network / 5xx / 429): exponential backoff + Retry-After until MAX_DELIVERY_ATTEMPTS
  if (newAttempts >= MAX_DELIVERY_ATTEMPTS || immediateManualRetry) {
    const isDlq = newAttempts >= MAX_DELIVERY_ATTEMPTS;
    await db
      .update(notifications)
      .set({
        status: isDlq ? "dead_letter" : "failed",
        deliveryStatus: "failed",
        lastHttpStatus: statusCode,
        attempts: newAttempts,
        error: errMsg,
        nextRetryAt: null,
        deadLetteredAt: isDlq ? now : null,
      })
      .where(eq(notifications.id, n.id));

    if (isDlq) {
      await triggerEmailFallback({ notification: n, inviteRow, prefs, failedChannel: ch.type, reasonError: errMsg });
    }
    return { ok: false, status: isDlq ? "dead_letter" : "failed", error: errMsg };
  }

  const backoffMs = BACKOFF_SCHEDULE_MS[Math.min(newAttempts - 1, BACKOFF_SCHEDULE_MS.length - 1)];
  const delayMs = Math.max(backoffMs, result.retryAfterMs ?? 0);
  const nextRetry = new Date(now.getTime() + delayMs);

  await db
    .update(notifications)
    .set({
      status: "pending",
      deliveryStatus: "retrying",
      lastHttpStatus: statusCode,
      attempts: newAttempts,
      error: `${errMsg} (retry #${newAttempts} scheduled)`,
      scheduledFor: nextRetry,
      nextRetryAt: nextRetry,
    })
    .where(eq(notifications.id, n.id));

  await enqueueDelivery(n.id, nextRetry).catch(() => undefined);
  return { ok: false, status: "pending", error: errMsg };
}

async function triggerEmailFallback(params: {
  notification: typeof notifications.$inferSelect;
  inviteRow: InviteEnvelope;
  prefs: typeof notificationPreferences.$inferSelect | null;
  failedChannel: ChannelType;
  reasonError: string;
}) {
  const { notification: n, inviteRow, prefs, failedChannel, reasonError } = params;
  if (failedChannel === "email") return;
  if (prefs && !prefs.emailFallback) return;

  const emailAdapter = getAdapter("email");
  if (!emailAdapter) return;

  const [verifiedEmailCh] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, n.userId),
        eq(notificationChannels.type, "email"),
        eq(notificationChannels.verified, true),
        eq(notificationChannels.enabled, true),
      ),
    )
    .limit(1);

  let targetEmail: string | null = null;
  if (verifiedEmailCh) {
    targetEmail = decryptSecret(verifiedEmailCh.destination);
  } else {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, n.userId)).limit(1);
    if (u?.email && !u.email.endsWith("@demo.invitz.app")) {
      targetEmail = u.email;
    }
  }
  if (!targetEmail) return;

  const [fallbackRow] = await db
    .insert(notifications)
    .values({
      userId: n.userId,
      inviteId: n.inviteId,
      channel: "email",
      channelId: null,
      reason: `Fallback after ${failedChannel} delivery failed (${n.reason})`,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning();

  if (!fallbackRow) return;

  const msg = buildInviteMessage(
    inviteRow,
    `Fallback email (${failedChannel} failed: ${reasonError.slice(0, 80)})`,
    verifiedEmailCh
      ? `${appUrl()}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(verifiedEmailCh.id))}`
      : undefined,
  );
  msg.kind = "fallback";
  msg.title = `[Invitz Fallback] ${inviteRow.title}`;

  const res = await emailAdapter.send(targetEmail, msg);
  await db
    .update(notifications)
    .set({
      status: res.ok ? (res.dryRun ? "dry_run" : "sent") : "failed",
      deliveryStatus: res.ok ? (res.dryRun ? "dry_run" : "accepted") : "failed",
      providerMessageId: res.providerMessageId ?? null,
      lastHttpStatus: res.statusCode ?? null,
      attempts: 1,
      error: res.error ?? null,
      sentAt: res.ok ? new Date() : null,
    })
    .where(eq(notifications.id, fallbackRow.id));
}

/**
 * Processes due digest batches for a specific (userId, channelId) pair cleanly and idempotently.
 */
export async function sendDigestBatch(userId: string, channelId: string, now = new Date()): Promise<number> {
  const dueRows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.channelId, channelId),
        eq(notifications.status, "queued"),
        isNull(notifications.digestSentAt),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      ),
    );

  if (dueRows.length === 0) return 0;

  const [ch] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, channelId)).limit(1);
  if (!ch || !ch.enabled) {
    await db
      .update(notifications)
      .set({ status: "skipped", error: "Channel disabled before digest ran." })
      .where(inArray(notifications.id, dueRows.map((r) => r.id)));
    return 0;
  }

  const adapter = getAdapter(ch.type);
  if (!adapter) return 0;
  if (ch.verifiedDryRun && adapter.configured()) {
    await db
      .update(notifications)
      .set({ status: "skipped", error: "Verified in dry-run mode only." })
      .where(inArray(notifications.id, dueRows.map((r) => r.id)));
    return 0;
  }

  const inviteIds = [...new Set(dueRows.map((r) => r.inviteId))];
  const inviteDetails = await db
    .select({
      id: invites.id,
      verdict: invites.verdict,
      sharerHandle: users.handle,
      title: events.title,
      startsAt: events.startsAt,
      location: events.location,
    })
    .from(invites)
    .innerJoin(events, eq(events.id, invites.eventId))
    .innerJoin(users, eq(users.id, invites.sharedById))
    .where(inArray(invites.id, inviteIds));

  const detailMap = new Map(inviteDetails.map((d) => [d.id, d]));
  const items = dueRows
    .map((r) => detailMap.get(r.inviteId))
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .slice(0, 10);

  if (items.length === 0) return 0;

  const plaintextDest = decryptSecret(ch.destination);
  const unsubscribeUrl =
    ch.type === "email"
      ? `${appUrl()}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(ch.id))}`
      : undefined;

  const digestMessage: OutboundMessage = {
    kind: "digest",
    title: `Your Invitz Digest · ${dueRows.length} new ${dueRows.length === 1 ? "invite" : "invites"}`,
    text: items
      .map(
        (d, i) =>
          `${i + 1}. ${d.verdict === "caution" ? "⚠️ " : ""}${d.title}${d.startsAt ? ` (${formatWhen(d.startsAt)})` : ""} — @${d.sharerHandle}`,
      )
      .join("\n"),
    url: `${appUrl()}/notifications`,
    unsubscribeUrl,
    digestItems: items.map((d) => ({
      title: d.title,
      url: `${appUrl()}/invites/${d.id}`,
      when: formatWhen(d.startsAt) || undefined,
      location: d.location || undefined,
      sharerHandle: d.sharerHandle,
      caution: d.verdict === "caution",
    })),
  };

  const result = await adapter.send(plaintextDest, digestMessage);
  const dueIds = dueRows.map((r) => r.id);

  if (result.ok) {
    await db
      .update(notifications)
      .set({
        status: result.dryRun ? "dry_run" : "sent",
        deliveryStatus: result.dryRun ? "dry_run" : "accepted",
        providerMessageId: result.providerMessageId ?? null,
        lastHttpStatus: result.statusCode ?? null,
        attempts: sql`${notifications.attempts} + 1`,
        digestSentAt: now,
        sentAt: now,
        error: null,
      })
      .where(and(inArray(notifications.id, dueIds), eq(notifications.status, "queued"), isNull(notifications.digestSentAt)));
    await publishBellUpdate({ userId, kind: "digest", at: now.toISOString() });
    return dueIds.length;
  }

  await db
    .update(notifications)
    .set({
      status: "failed",
      deliveryStatus: "failed",
      lastHttpStatus: result.statusCode ?? null,
      attempts: sql`${notifications.attempts} + 1`,
      error: result.error ?? "Digest delivery failed",
    })
    .where(and(inArray(notifications.id, dueIds), eq(notifications.status, "queued")));

  return 0;
}

/**
 * Sweeps due scheduled/retried individual notifications and due digest batches.
 * Called by `scripts/worker.ts` and `/api/cron/notifications`.
 */
export async function processDueNotificationsAndDigests(now = new Date()) {
  // 1. Due deferred / retry notifications
  const dueSingle = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "pending"),
        ne(notifications.channel, "in_app"),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      ),
    )
    .limit(100);

  let delivered = 0;
  for (const row of dueSingle) {
    const res = await deliverNotificationNow(row.id);
    if (res.ok) delivered += 1;
  }

  // 2. Due digest buckets grouped by (userId, channelId)
  const dueDigestPairs = await db
    .selectDistinct({ userId: notifications.userId, channelId: notifications.channelId })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "queued"),
        isNull(notifications.digestSentAt),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      ),
    )
    .limit(100);

  let digestCount = 0;
  for (const pair of dueDigestPairs) {
    if (!pair.channelId) continue;
    digestCount += await sendDigestBatch(pair.userId, pair.channelId, now);
  }

  return { delivered, digestCount };
}

/** Sends the one-time verification code (or generates a Telegram /start token link). */
export async function sendVerificationCode(channelId: string) {
  const [ch] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, channelId)).limit(1);
  if (!ch) return { ok: false, error: "Channel not found" };
  const adapter = getAdapter(ch.type);
  if (!adapter) return { ok: false, error: "Unknown channel type" };

  const plaintextDest = decryptSecret(ch.destination);
  const code = String(randomInt(100000, 1000000));
  const linkToken = ch.type === "telegram" ? randomBytes(16).toString("hex") : null;

  await db
    .update(notificationChannels)
    .set({
      verifyCode: null,
      verifyCodeHash: hashVerifySecret(code),
      verifyTokenHash: linkToken ? hashVerifySecret(linkToken) : null,
      verifyExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      verifyAttempts: 0,
      verifyLockedUntil: null,
    })
    .where(eq(notificationChannels.id, channelId));

  if (ch.type === "telegram" && plaintextDest.startsWith("pending:")) {
    // Deep link verification: user clicks `https://t.me/<bot>?start=<token>`, bot webhook binds chat_id + verifies!
    const botUser = process.env.TELEGRAM_BOT_USERNAME;
    const isDry = !adapter.configured();
    return {
      ok: true,
      dryRun: isDry,
      ...(isDry ? { dryRunCode: code } : {}),
      telegramStartUrl: botUser && linkToken ? `https://t.me/${botUser}?start=${linkToken}` : undefined,
      telegramStartCommand: linkToken ? `/start ${linkToken}` : undefined,
    };
  }

  const sendRes = await adapter.send(plaintextDest, {
    kind: "verify",
    verifyCode: code,
    title: "Invitz verification code",
    text: `Your code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this message.`,
    url: appUrl(),
  });

  if (sendRes.ok && sendRes.dryRun) {
    return { ...sendRes, dryRunCode: code };
  }
  return sendRes;
}
