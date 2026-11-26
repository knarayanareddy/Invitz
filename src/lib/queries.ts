import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  groupMembers,
  groups,
  inviteGroups,
  invites,
  notifications,
  users,
  type InviteStatus,
  type Verdict,
} from "@/db/schema";

export type FeedInvite = {
  id: string;
  note: string;
  createdAt: Date;
  verdict: Verdict;
  confidence: number;
  summary: string;
  status: InviteStatus;
  event: {
    id: string;
    title: string;
    description: string;
    imageUrl: string | null;
    host: string;
    url: string;
    startsAt: Date | null;
    location: string | null;
  };
  sharer: { id: string; handle: string; displayName: string; trustScore: number };
  groups: { id: string; slug: string; name: string; type: string }[];
};

export type FeedOptions = {
  viewerId: string | null;
  tab?: "all" | "mine" | "following";
  sharerId?: string;
  groupId?: string;
  inviteId?: string;
  limit?: number;
};

/** Visibility rule: public-group invites are visible to everyone; private-group invites only to members. */
export function visibleTo(viewerId: string | null): SQL {
  if (!viewerId) {
    return sql`exists (select 1 from invite_groups ig join groups g on g.id = ig.group_id
      where ig.invite_id = ${invites.id} and g.visibility = 'public')`;
  }
  return sql`(exists (select 1 from invite_groups ig join groups g on g.id = ig.group_id
      where ig.invite_id = ${invites.id} and (g.visibility = 'public' or exists
        (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = ${viewerId})))
    or ${invites.sharedById} = ${viewerId})`;
}

export async function canViewInvite(viewerId: string | null, inviteId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.status, "published"), visibleTo(viewerId)))
    .limit(1);
  return !!row;
}

export function filterVisibleTargetGroups<T extends { inviteId: string; visibility: string; id: string }>(
  targets: T[],
  memberGroupIds: Set<string>,
  inviteOwnerById: Map<string, string>,
  viewerId: string | null,
): T[] {
  return targets.filter(
    (t) =>
      t.visibility === "public" ||
      memberGroupIds.has(t.id) ||
      (viewerId !== null && inviteOwnerById.get(t.inviteId) === viewerId),
  );
}

export async function getFeed(opts: FeedOptions): Promise<FeedInvite[]> {
  const { viewerId } = opts;
  const where: SQL[] = [visibleTo(viewerId)];

  if (opts.inviteId) {
    where.push(eq(invites.id, opts.inviteId));
    // The sharer can still open their own blocked/flagged invites to see why.
    where.push(viewerId ? sql`(${invites.status} = 'published' or ${invites.sharedById} = ${viewerId})` : eq(invites.status, "published"));
  } else {
    where.push(eq(invites.status, "published"));
  }
  if (opts.sharerId) where.push(eq(invites.sharedById, opts.sharerId));
  if (opts.groupId) {
    where.push(sql`exists (select 1 from invite_groups ig where ig.invite_id = ${invites.id} and ig.group_id = ${opts.groupId})`);
  }
  if (viewerId && opts.tab === "mine") {
    where.push(sql`exists (select 1 from invite_groups ig join group_members gm on gm.group_id = ig.group_id
      where ig.invite_id = ${invites.id} and gm.user_id = ${viewerId})`);
  }
  if (viewerId && opts.tab === "following") {
    where.push(sql`${invites.sharedById} in (select followee_id from follows where follower_id = ${viewerId})`);
  }

  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));

  const rows = await db
    .select({
      id: invites.id,
      note: invites.note,
      createdAt: invites.createdAt,
      verdict: invites.verdict,
      confidence: invites.confidence,
      summary: invites.summary,
      status: invites.status,
      event: {
        id: events.id,
        title: events.title,
        description: events.description,
        imageUrl: events.imageUrl,
        host: events.host,
        url: events.url,
        startsAt: events.startsAt,
        location: events.location,
      },
      sharer: { id: users.id, handle: users.handle, displayName: users.displayName, trustScore: users.trustScore },
    })
    .from(invites)
    .innerJoin(events, eq(events.id, invites.eventId))
    .innerJoin(users, eq(users.id, invites.sharedById))
    .where(and(...where))
    .orderBy(desc(invites.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const targets = await db
    .select({
      inviteId: inviteGroups.inviteId,
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      type: groups.type,
      visibility: groups.visibility,
    })
    .from(inviteGroups)
    .innerJoin(groups, eq(groups.id, inviteGroups.groupId))
    .where(inArray(inviteGroups.inviteId, rows.map((r) => r.id)));

  const memberGroupIds = viewerId
    ? new Set(
        (
          await db
            .select({ groupId: groupMembers.groupId })
            .from(groupMembers)
            .where(eq(groupMembers.userId, viewerId))
        ).map((m) => m.groupId),
      )
    : new Set<string>();

  const ownerByInvite = new Map(rows.map((r) => [r.id, r.sharer.id]));
  const visibleTargets = filterVisibleTargetGroups(targets, memberGroupIds, ownerByInvite, viewerId);

  return rows.map((r) => ({
    ...r,
    groups: visibleTargets
      .filter((t) => t.inviteId === r.id)
      .map(({ inviteId: _i, visibility: _v, ...g }) => g),
  }));
}

export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.channel, "in_app"), sql`${notifications.readAt} is null`));
  return row?.count ?? 0;
}

export async function myMemberships(userId: string) {
  return db
    .select({ id: groups.id, slug: groups.slug, name: groups.name, type: groups.type, visibility: groups.visibility })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId));
}
