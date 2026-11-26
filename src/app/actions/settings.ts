"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  groupMembers,
  groups,
  notificationChannels,
  notificationPreferences,
  topics,
  userInterests,
  users,
  type ChannelType,
  type DigestMode,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { encryptSecret, hashDestination, verifySecretConstantTime } from "@/lib/crypto";
import { HANDLE_CHANGE_COOLDOWN_MS, validateHandle } from "@/lib/identity";
import { getAdapter, normalizePhone } from "@/lib/notify/adapters";
import { sendVerificationCode, WHATSAPP_OPT_IN_CONSENT_TEXT } from "@/lib/notify/dispatch";
import { isValidTimeHHMM, isValidTimeZone } from "@/lib/notify/schedule";
import { isUuid, sanitizeNextPath } from "@/lib/url";

const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_LOCK_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const DIGEST_MODES = new Set<DigestMode>(["instant", "hourly", "daily", "weekly"]);

const back = (msg?: string, key: "error" | "ok" = "error"): never =>
  redirect(`/settings${msg ? `?${key}=${encodeURIComponent(msg)}` : ""}`);

export async function updateProfile(formData: FormData) {
  const user = await requireUser("/settings");
  const displayName = String(formData.get("displayName") ?? "").trim().slice(0, 60);
  const headline = String(formData.get("headline") ?? "").trim().slice(0, 100);
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 400);
  const rawHandle = String(formData.get("handle") ?? user.handle);
  const rawImage = String(formData.get("image") ?? "").trim().slice(0, 500);

  if (!displayName) back("Display name is required.");

  let nextImage: string | null = null;
  if (rawImage) {
    try {
      const parsed = new URL(rawImage);
      if (parsed.protocol !== "https:") back("Avatar URL must use https://.");
      nextImage = parsed.toString();
    } catch {
      back("Avatar URL is not a valid URL.");
    }
  }

  const handleCheck = validateHandle(rawHandle);
  if (!handleCheck.ok) back(handleCheck.error);
  const nextHandle = handleCheck.ok ? handleCheck.handle : user.handle;
  const handleChanged = nextHandle.toLowerCase() !== user.handle.toLowerCase();

  if (handleChanged) {
    if (
      user.handleUpdatedAt &&
      Date.now() - user.handleUpdatedAt.getTime() < HANDLE_CHANGE_COOLDOWN_MS
    ) {
      back("You can only change your @handle once every 30 days.");
    }
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.handle})`, nextHandle), ne(users.id, user.id)))
      .limit(1);
    if (taken) back(`@${nextHandle} is already taken.`);
  }

  try {
    await db
      .update(users)
      .set({
        displayName,
        name: displayName,
        headline,
        bio,
        image: nextImage,
        ...(handleChanged ? { handle: nextHandle, handleUpdatedAt: new Date() } : {}),
      })
      .where(eq(users.id, user.id));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505") {
      back(`@${nextHandle} is already taken.`);
    }
    throw err;
  }

  revalidatePath("/", "layout");
  back("Profile saved.", "ok");
}

/** Marking an interest joins the matching topic community; unmarking an interest leaves it. */
export async function saveInterests(formData: FormData) {
  const user = await requireUser("/settings");
  const chosen = formData.getAll("topic").map(String).filter(isUuid);
  const redirectTo = sanitizeNextPath(String(formData.get("redirectTo") ?? ""));

  await db.transaction(async (tx) => {
    const allTopics = await tx.select().from(topics);
    const prevInterests = new Set(
      (await tx.select({ topicId: userInterests.topicId }).from(userInterests).where(eq(userInterests.userId, user.id))).map(
        (r) => r.topicId,
      ),
    );
    const valid = allTopics.filter((t) => chosen.includes(t.id));
    const wanted = new Set(valid.map((t) => t.id));

    await tx.delete(userInterests).where(eq(userInterests.userId, user.id));
    if (valid.length) {
      await tx.insert(userInterests).values(valid.map((t) => ({ userId: user.id, topicId: t.id })));
    }

    const topicGroups = await tx
      .select({ id: groups.id, topicId: groups.topicId })
      .from(groups)
      .where(eq(groups.type, "topic"));

    const toJoin = topicGroups.filter((g) => g.topicId && wanted.has(g.topicId));
    // Only leave topic groups that were previously marked as interests and explicitly unchecked.
    const toLeave = topicGroups.filter((g) => g.topicId && prevInterests.has(g.topicId) && !wanted.has(g.topicId));

    if (toJoin.length) {
      await tx
        .insert(groupMembers)
        .values(toJoin.map((g) => ({ groupId: g.id, userId: user.id })))
        .onConflictDoNothing();
    }
    if (toLeave.length) {
      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.userId, user.id), inArray(groupMembers.groupId, toLeave.map((g) => g.id))));
    }
  });

  revalidatePath("/", "layout");
  if (redirectTo !== "/") redirect(redirectTo);
  back("Interests saved. You've been added to the matching communities.", "ok");
}

export async function saveNotificationPreferences(formData: FormData) {
  const user = await requireUser("/settings");
  const timezone = String(formData.get("timezone") ?? "UTC").trim() || "UTC";
  if (!isValidTimeZone(timezone)) {
    back("Please choose a valid IANA time zone.");
  }

  const quietStartRaw = String(formData.get("quietStart") ?? "").trim();
  const quietEndRaw = String(formData.get("quietEnd") ?? "").trim();
  if ((quietStartRaw && !quietEndRaw) || (!quietStartRaw && quietEndRaw)) {
    back("Specify both quiet hours start and end times, or leave both empty.");
  }
  if (quietStartRaw && (!isValidTimeHHMM(quietStartRaw) || !isValidTimeHHMM(quietEndRaw))) {
    back("Quiet hours must use 24-hour HH:MM format (e.g. 22:00 and 08:00).");
  }

  const rawCap = Number(formData.get("dailyCap") ?? 5);
  if (!Number.isInteger(rawCap) || rawCap < 0 || rawCap > 50) {
    back("Daily external cap must be between 0 (unlimited) and 50.");
  }

  const rawDigest = String(formData.get("digestMode") ?? "instant") as DigestMode;
  const digestMode: DigestMode = DIGEST_MODES.has(rawDigest) ? rawDigest : "instant";
  const emailFallback = formData.get("emailFallback") === "true" || formData.get("emailFallback") === "on";

  await db
    .insert(notificationPreferences)
    .values({
      userId: user.id,
      timezone,
      quietStart: quietStartRaw || null,
      quietEnd: quietEndRaw || null,
      dailyCap: rawCap,
      digestMode,
      emailFallback,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        timezone,
        quietStart: quietStartRaw || null,
        quietEnd: quietEndRaw || null,
        dailyCap: rawCap,
        digestMode,
        emailFallback,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/settings");
  back("Delivery preferences saved.", "ok");
}

export async function addChannel(formData: FormData) {
  const user = await requireUser("/settings");
  const type = String(formData.get("type") ?? "") as ChannelType;
  const adapter = getAdapter(type);
  if (!adapter) back("Unknown channel.");

  const disabledReason = adapter!.disabledReason?.();
  if (disabledReason) back(disabledReason);

  const rawDest = String(formData.get("destination") ?? "").trim();
  let destination = rawDest;
  if (type === "whatsapp" || type === "signal") {
    destination = normalizePhone(rawDest);
  } else if (type === "email") {
    destination = rawDest.toLowerCase();
  } else if (type === "telegram" && (!rawDest || rawDest.toLowerCase() === "connect")) {
    destination = `pending:${randomUUID()}`;
  }

  const problem = adapter!.validate(destination);
  if (problem) back(problem);

  if (type === "whatsapp") {
    const consented = formData.get("whatsappConsent") === "true" || formData.get("whatsappConsent") === "on";
    if (!consented) {
      back("Please confirm WhatsApp opt-in consent before adding a WhatsApp number.");
    }
  }

  const rawDigest = String(formData.get("digestMode") ?? "").trim() as DigestMode;
  const digestMode = DIGEST_MODES.has(rawDigest) ? rawDigest : null;

  const { ciphertext, keyId } = encryptSecret(destination);
  const destinationHash = hashDestination(type, destination);

  const [channel] = await db
    .insert(notificationChannels)
    .values({
      userId: user.id,
      type,
      destination: ciphertext,
      destinationHash,
      destinationKeyId: keyId,
      digestMode,
      ...(type === "whatsapp"
        ? {
            optedInAt: new Date(),
            optInSource: "settings_otp",
            optInConsentText: WHATSAPP_OPT_IN_CONSENT_TEXT,
          }
        : {}),
    })
    .onConflictDoNothing()
    .returning();

  if (!channel) back("That destination is already connected.");

  const result = (await sendVerificationCode(channel.id)) as {
    ok: boolean;
    dryRun?: boolean;
    dryRunCode?: string;
    error?: string;
    telegramStartUrl?: string;
    telegramStartCommand?: string;
  };
  revalidatePath("/settings");
  if (!result.ok) back(`Channel added, but sending verification failed (${result.error}). Use "Resend code".`);

  if (result.telegramStartCommand) {
    const hint = result.telegramStartUrl
      ? `Open ${result.telegramStartUrl} and press Start (or send "${result.telegramStartCommand}" to the bot).`
      : result.dryRun && result.dryRunCode
        ? `Telegram channel added in dry-run mode (test code: ${result.dryRunCode}, or bot command "${result.telegramStartCommand}").`
        : `Send "${result.telegramStartCommand}" to your Invitz Telegram bot to finish connecting.`;
    back(hint, "ok");
  }

  back(
    result.dryRun
      ? `Channel added in dry-run mode${result.dryRunCode ? ` (test code: ${result.dryRunCode})` : ""}.`
      : "Channel added. Check your messages for the 6-digit verification code.",
    "ok",
  );
}

export async function resendCode(formData: FormData) {
  const user = await requireUser("/settings");
  const id = String(formData.get("channelId") ?? "");
  if (!isUuid(id)) back("Channel not found.");
  const [ch] = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id)))
    .limit(1);
  if (!ch) back("Channel not found.");
  if (ch.verifyExpiresAt) {
    const issuedAtMs = ch.verifyExpiresAt.getTime() - 15 * 60 * 1000;
    if (Date.now() - issuedAtMs < RESEND_COOLDOWN_MS) {
      back("Please wait a minute before requesting another code.");
    }
  }
  const result = (await sendVerificationCode(id)) as {
    ok: boolean;
    dryRun?: boolean;
    dryRunCode?: string;
    error?: string;
    telegramStartUrl?: string;
    telegramStartCommand?: string;
  };
  revalidatePath("/settings");
  if (result.telegramStartCommand) {
    const hint = result.telegramStartUrl
      ? `Open ${result.telegramStartUrl} or send "${result.telegramStartCommand}" to the bot.`
      : `Send "${result.telegramStartCommand}" to the Invitz Telegram bot.`;
    back(hint, "ok");
  }
  back(
    result.ok
      ? result.dryRun && result.dryRunCode
        ? `A new dry-run test code was generated: ${result.dryRunCode}`
        : "A new code was sent."
      : `Could not send the code (${result.error}).`,
    result.ok ? "ok" : "error",
  );
}

export async function verifyChannel(formData: FormData) {
  const user = await requireUser("/settings");
  const id = String(formData.get("channelId") ?? "");
  if (!isUuid(id)) back("Channel not found.");
  const code = String(formData.get("code") ?? "").trim();
  const [ch] = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id)))
    .limit(1);
  if (!ch) back("Channel not found.");
  if (ch.verifyLockedUntil && ch.verifyLockedUntil > new Date()) {
    back("Too many incorrect attempts. Try again in 15 minutes.");
  }
  const hasCode = Boolean(ch.verifyCodeHash || ch.verifyCode);
  if (!hasCode || !ch.verifyExpiresAt || ch.verifyExpiresAt < new Date()) {
    back("That code expired. Request a new one.");
  }

  const valid = ch.verifyCodeHash
    ? verifySecretConstantTime(code, ch.verifyCodeHash)
    : ch.verifyCode === code;

  if (!valid) {
    const nextAttempts = ch.verifyAttempts + 1;
    const locked = nextAttempts >= MAX_VERIFY_ATTEMPTS;
    await db
      .update(notificationChannels)
      .set({
        verifyAttempts: nextAttempts,
        verifyLockedUntil: locked ? new Date(Date.now() + VERIFY_LOCK_MS) : null,
        ...(locked ? { verifyCode: null, verifyCodeHash: null, verifyTokenHash: null, verifyExpiresAt: null } : {}),
      })
      .where(eq(notificationChannels.id, id));
    back(locked ? "Too many incorrect attempts. Request a new code in 15 minutes." : "Incorrect code.");
  }

  const adapter = getAdapter(ch.type);
  const isDryRun = adapter ? !adapter.configured() : true;
  await db
    .update(notificationChannels)
    .set({
      verified: true,
      verifiedDryRun: isDryRun,
      verifyCode: null,
      verifyCodeHash: null,
      verifyTokenHash: null,
      verifyExpiresAt: null,
      verifyAttempts: 0,
      verifyLockedUntil: null,
      failureCount: 0,
      disabledReason: null,
    })
    .where(eq(notificationChannels.id, id));
  revalidatePath("/settings");
  back(
    isDryRun
      ? "Channel verified in dry-run mode (live sends disabled until re-verified with live credentials)."
      : "Channel verified. You'll now receive invites there.",
    "ok",
  );
}

export async function updateChannel(formData: FormData) {
  const user = await requireUser("/settings");
  const id = String(formData.get("channelId") ?? "");
  if (!isUuid(id)) return;
  const field = String(formData.get("field") ?? "");

  if (field === "digestMode") {
    const raw = String(formData.get("value") ?? "").trim() as DigestMode;
    const nextDigest = DIGEST_MODES.has(raw) ? raw : null;
    await db
      .update(notificationChannels)
      .set({ digestMode: nextDigest })
      .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id), eq(notificationChannels.verified, true)));
    revalidatePath("/settings");
    return;
  }

  const value = formData.get("value") === "true";
  if (field !== "enabled" && field !== "includeUnverified") return;

  await db
    .update(notificationChannels)
    .set(
      field === "enabled"
        ? { enabled: value, ...(value ? { failureCount: 0, disabledReason: null } : {}) }
        : { includeUnverified: value },
    )
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id), eq(notificationChannels.verified, true)));
  revalidatePath("/settings");
}

export async function removeChannel(formData: FormData) {
  const user = await requireUser("/settings");
  const id = String(formData.get("channelId") ?? "");
  if (!isUuid(id)) return;
  await db.delete(notificationChannels).where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id)));
  revalidatePath("/settings");
}
