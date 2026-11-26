import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  follows,
  groupMembers,
  groups,
  invites,
  notificationChannels,
  notifications,
  topics,
  userInterests,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [interests, memberships, following, followers, myInvites, myNotifications, channels] = await Promise.all([
    db
      .select({ slug: topics.slug, name: topics.name })
      .from(userInterests)
      .innerJoin(topics, eq(topics.id, userInterests.topicId))
      .where(eq(userInterests.userId, user.id)),
    db
      .select({ slug: groups.slug, name: groups.name, role: groupMembers.role, muted: groupMembers.muted, joinedAt: groupMembers.joinedAt })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, user.id)),
    db
      .select({ followeeId: follows.followeeId, notify: follows.notify, createdAt: follows.createdAt })
      .from(follows)
      .where(eq(follows.followerId, user.id)),
    db
      .select({ followerId: follows.followerId, createdAt: follows.createdAt })
      .from(follows)
      .where(eq(follows.followeeId, user.id)),
    db
      .select({
        id: invites.id,
        note: invites.note,
        status: invites.status,
        verdict: invites.verdict,
        confidence: invites.confidence,
        summary: invites.summary,
        createdAt: invites.createdAt,
        eventUrl: events.url,
        eventTitle: events.title,
      })
      .from(invites)
      .innerJoin(events, eq(events.id, invites.eventId))
      .where(eq(invites.sharedById, user.id))
      .orderBy(desc(invites.createdAt)),
    db
      .select({
        id: notifications.id,
        inviteId: notifications.inviteId,
        channel: notifications.channel,
        reason: notifications.reason,
        status: notifications.status,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(200),
    db
      .select({
        id: notificationChannels.id,
        type: notificationChannels.type,
        destination: notificationChannels.destination,
        verified: notificationChannels.verified,
        enabled: notificationChannels.enabled,
        includeUnverified: notificationChannels.includeUnverified,
        createdAt: notificationChannels.createdAt,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, user.id)),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      handle: user.handle,
      displayName: user.displayName,
      headline: user.headline,
      bio: user.bio,
      image: user.image,
      trustScore: user.trustScore,
      createdAt: user.createdAt,
    },
    interests,
    memberships,
    following,
    followers,
    invites: myInvites,
    notifications: myNotifications,
    channels,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="invitz-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
