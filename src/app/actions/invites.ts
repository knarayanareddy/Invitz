"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { events, groupMembers, groups, inviteGroups, invites, qcChecks, reports, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  NEW_ACCOUNT_MAX_GROUPS,
  NEW_ACCOUNT_MAX_INVITES_PER_DAY,
  isDisposableEmail,
  isNewAccountRestricted,
} from "@/lib/identity";
import { fanOutInvite } from "@/lib/notify/dispatch";
import { runQc } from "@/lib/qc/pipeline";
import { canViewInvite } from "@/lib/queries";
import { canonicalizeUrl, hostOf, isUuid, parseUserUrl } from "@/lib/url";

export type ShareState = { error?: string; values?: { url: string; note: string; groupIds: string[] } };

const REPORT_REASONS = new Set(["spam", "scam", "misleading", "inappropriate"]);

function validDate(s?: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function shareInvite(_prev: ShareState, formData: FormData): Promise<ShareState> {
  const user = await requireUser("/share");
  const urlInput = String(formData.get("url") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const groupIds = [...new Set(formData.getAll("group").map(String))];
  const values = { url: urlInput, note, groupIds };

  if (isDisposableEmail(user.email)) {
    return {
      error: "Disposable e-mail accounts can browse Invitz, but cannot share invites.",
      values,
    };
  }
  if (note.length > 500) return { error: "Keep your note under 500 characters.", values };
  if (groupIds.length === 0) return { error: "Choose at least one audience.", values };
  if (groupIds.length > 10) return { error: "You can share to at most 10 audiences at once.", values };
  if (!groupIds.every(isUuid)) return { error: "One of the selected audiences is invalid.", values };

  if (isNewAccountRestricted(user)) {
    if (groupIds.length > NEW_ACCOUNT_MAX_GROUPS) {
      return {
        error: `New accounts (< 24h) can share to at most ${NEW_ACCOUNT_MAX_GROUPS} audiences at once.`,
        values,
      };
    }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ count: dayCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invites)
      .where(and(eq(invites.sharedById, user.id), gte(invites.createdAt, dayAgo)));
    if (dayCount >= NEW_ACCOUNT_MAX_INVITES_PER_DAY) {
      return {
        error: `New accounts (< 24h) can share at most ${NEW_ACCOUNT_MAX_INVITES_PER_DAY} invites per day.`,
        values,
      };
    }
  }

  const parsed = parseUserUrl(urlInput);
  if (!parsed.ok) return { error: parsed.error, values };

  // Authorisation: anyone may post to general/topic groups; custom groups require membership.
  const targets = await db.select().from(groups).where(inArray(groups.id, groupIds));
  if (targets.length !== groupIds.length) return { error: "One of the selected audiences no longer exists.", values };
  const customIds = targets.filter((g) => g.type === "custom").map((g) => g.id);
  if (customIds.length) {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, user.id), inArray(groupMembers.groupId, customIds)));
    if (memberships.length !== customIds.length) return { error: "You can only share to custom groups you belong to.", values };
  }

  const canonicalUrl = canonicalizeUrl(parsed.url);
  // Avoid leaking private custom group names to third-party AI vendors.
  const aiAudiences = targets.map((g) => (g.visibility === "private" ? "Private group" : g.name));

  const qc = await runQc({
    url: parsed.url,
    canonicalUrl,
    note,
    userId: user.id,
    groupIds,
    audiences: aiAudiences,
  });

  // Rate-limited shares return an error immediately without writing spam rows or extending lockouts.
  if (qc.rateLimited) {
    return { error: qc.summary.replace(/^Blocked:\s*/, ""), values };
  }

  // Upsert the event (one row per unique link), enriching empty metadata if a previous fetch failed.
  const finalUrlString = qc.page?.finalUrl ?? parsed.url.toString();
  const host = hostOf(canonicalUrl);
  const page = qc.page;
  const ex = qc.ai?.extracted;
  const extractedTitle = (page?.event?.name || ex?.title || page?.title || host).slice(0, 200);
  const extractedDescription = page?.description ?? "";
  const extractedImageUrl = page?.imageUrl ?? null;
  const extractedSiteName = page?.siteName ?? null;
  const extractedStartsAt = validDate(page?.event?.startDate) ?? validDate(ex?.startsAt);
  const extractedLocation = page?.event?.location ?? ex?.location ?? null;

  const status = qc.verdict === "rejected" ? "blocked" : "published";

  const invite = await db.transaction(async (tx) => {
    const [existingEvent] = await tx.select().from(events).where(eq(events.canonicalUrl, canonicalUrl)).limit(1);
    let eventId: string;
    if (!existingEvent) {
      const [insertedEvent] = await tx
        .insert(events)
        .values({
          canonicalUrl,
          url: finalUrlString,
          host,
          title: extractedTitle,
          description: extractedDescription,
          imageUrl: extractedImageUrl,
          siteName: extractedSiteName,
          startsAt: extractedStartsAt,
          location: extractedLocation,
        })
        .onConflictDoNothing()
        .returning({ id: events.id });
      if (insertedEvent) {
        eventId = insertedEvent.id;
      } else {
        const [raced] = await tx.select({ id: events.id }).from(events).where(eq(events.canonicalUrl, canonicalUrl)).limit(1);
        eventId = raced.id;
      }
    } else {
      eventId = existingEvent.id;
      if (status === "published" && page) {
        await tx
          .update(events)
          .set({
            title: existingEvent.title === existingEvent.host && extractedTitle !== host ? extractedTitle : existingEvent.title,
            description: existingEvent.description || extractedDescription,
            imageUrl: existingEvent.imageUrl ?? extractedImageUrl,
            siteName: existingEvent.siteName ?? extractedSiteName,
            startsAt: existingEvent.startsAt ?? extractedStartsAt,
            location: existingEvent.location ?? extractedLocation,
          })
          .where(eq(events.id, existingEvent.id));
      }
    }

    const [createdInvite] = await tx
      .insert(invites)
      .values({
        eventId,
        sharedById: user.id,
        note,
        status,
        verdict: qc.verdict,
        confidence: qc.confidence,
        summary: qc.summary,
      })
      .returning();

    await tx.insert(inviteGroups).values(groupIds.map((groupId) => ({ inviteId: createdInvite.id, groupId })));
    await tx.insert(qcChecks).values({
      inviteId: createdInvite.id,
      verdict: qc.verdict,
      confidence: qc.confidence,
      provider: qc.provider,
      model: qc.model,
      findings: qc.findings,
      aiRaw: qc.ai,
      pageFetched: !!page,
      durationMs: qc.durationMs,
    });

    // Reputation: verified shares build trust, blocked ones cost it.
    const delta = qc.verdict === "verified" ? 1 : qc.verdict === "rejected" ? -5 : 0;
    if (delta !== 0) {
      await tx
        .update(users)
        .set({ trustScore: sql`greatest(0, least(100, ${users.trustScore} + ${delta}))` })
        .where(eq(users.id, user.id));
    }

    return createdInvite;
  });

  if (status === "published") {
    after(async () => {
      try {
        await fanOutInvite(invite.id);
      } catch (err) {
        console.error("[notify] fan-out failed for invite", invite.id, err);
      }
    });
  }
  revalidatePath("/", "layout");
  redirect(`/invites/${invite.id}`);
}

export async function reportInvite(formData: FormData) {
  const user = await requireUser();
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!isUuid(inviteId)) redirect("/");
  const rawReason = String(formData.get("reason") ?? "spam");
  const reason = REPORT_REASONS.has(rawReason) ? rawReason : "spam";
  const details = String(formData.get("details") ?? "").trim().slice(0, 500);

  const visible = await canViewInvite(user.id, inviteId);
  if (!visible) redirect("/");

  const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId)).limit(1);
  if (!invite || invite.sharedById === user.id || invite.status !== "published") redirect("/");

  await db.transaction(async (tx) => {
    await tx.insert(reports).values({ inviteId, reporterId: user.id, reason, details }).onConflictDoNothing();
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.inviteId, inviteId));

    // Community safety net: 3 distinct reporters auto-hide the invite atomically pending moderator review.
    if (count >= 3) {
      const flagged = await tx
        .update(invites)
        .set({ status: "flagged" })
        .where(and(eq(invites.id, inviteId), eq(invites.status, "published")))
        .returning({ id: invites.id });
      if (flagged.length > 0) {
        await tx
          .update(users)
          .set({ trustScore: sql`greatest(0, ${users.trustScore} - 10)` })
          .where(eq(users.id, invite.sharedById));
      }
    }
  });

  revalidatePath("/", "layout");
  redirect(`/invites/${inviteId}?reported=1`);
}
