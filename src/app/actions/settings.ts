"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { groupMembers, groups, notificationChannels, topics, userInterests, users, type ChannelType } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { HANDLE_CHANGE_COOLDOWN_MS, validateHandle } from "@/lib/identity";
import { getAdapter, normalizePhone } from "@/lib/notify/adapters";
import { sendVerificationCode } from "@/lib/notify/dispatch";
import { isUuid, sanitizeNextPath } from "@/lib/url";

const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_LOCK_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

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

export async function addChannel(formData: FormData) {
  const user = await requireUser("/settings");
  const type = String(formData.get("type") ?? "");
  const adapter = getAdapter(type);
  if (!adapter) back("Unknown channel.");
  const rawDest = String(formData.get("destination") ?? "").trim();
  const destination = type === "discord" ? rawDest : normalizePhone(rawDest);
  const problem = adapter!.validate(destination);
  if (problem) back(problem);

  const [channel] = await db
    .insert(notificationChannels)
    .values({ userId: user.id, type: type as ChannelType, destination })
    .onConflictDoNothing()
    .returning();
  if (!channel) back("That destination is already connected.");
  const result = await sendVerificationCode(channel.id);
  revalidatePath("/settings");
  if (!result.ok) back(`Channel added, but sending the code failed (${result.error}). Use "Resend code".`);
  back(
    result.dryRun
      ? "Channel added (dry-run mode: see the test code below)."
      : "Channel added. Check your messages for the code.",
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
  const result = await sendVerificationCode(id);
  revalidatePath("/settings");
  back(result.ok ? "A new code was sent." : `Could not send the code (${result.error}).`, result.ok ? "ok" : "error");
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
  if (!ch.verifyCode || !ch.verifyExpiresAt || ch.verifyExpiresAt < new Date()) {
    back("That code expired. Request a new one.");
  }
  if (ch.verifyCode !== code) {
    const nextAttempts = ch.verifyAttempts + 1;
    const locked = nextAttempts >= MAX_VERIFY_ATTEMPTS;
    await db
      .update(notificationChannels)
      .set({
        verifyAttempts: nextAttempts,
        verifyLockedUntil: locked ? new Date(Date.now() + VERIFY_LOCK_MS) : null,
        ...(locked ? { verifyCode: null, verifyExpiresAt: null } : {}),
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
      verifyExpiresAt: null,
      verifyAttempts: 0,
      verifyLockedUntil: null,
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
  const field = String(formData.get("field"));
  const value = formData.get("value") === "true";
  if (field !== "enabled" && field !== "includeUnverified") return;
  await db
    .update(notificationChannels)
    .set(field === "enabled" ? { enabled: value } : { includeUnverified: value })
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
