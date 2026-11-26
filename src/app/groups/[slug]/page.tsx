import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addMembers, joinGroup, leaveGroup, removeMember, toggleMute } from "@/app/actions/groups";
import { Avatar, EmptyState, InviteCard } from "@/components/invite-card";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ warn?: string }>;
}) {
  const { slug } = await params;
  const { warn } = await searchParams;
  const user = await getCurrentUser();
  const [group] = await db.select().from(groups).where(eq(groups.slug, slug)).limit(1);
  if (!group) notFound();

  const [meRow] = user
    ? await db
        .select({ role: groupMembers.role, muted: groupMembers.muted })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id)))
        .limit(1)
    : [];
  if (group.visibility === "private" && !meRow) notFound();

  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, group.id));

  const members = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, group.id))
    .limit(200);

  const feed = await getFeed({ viewerId: user?.id ?? null, groupId: group.id });
  const isOwner = group.ownerId === user?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/groups" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
          ← All groups
        </Link>
        <span className="inv-kicker">
          {group.type} community · {group.visibility}
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {warn && (
            <p
              role="status"
              className="inv-verdict-caution px-4 py-3 text-sm font-medium"
              style={{ borderRadius: "var(--inv-radius-input)" }}
            >
              {warn}
            </p>
          )}

          <header className="inv-card p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inv-kicker">
                    {group.type} group · {group.visibility}
                  </span>
                  {meRow && (
                    <span className="inv-chip-accent px-2.5 py-0.5 text-[11px] font-semibold">
                      Member
                    </span>
                  )}
                </div>
                <h1 className="inv-heading mt-1 text-3xl font-bold">#{group.name}</h1>
                <p className="inv-text-secondary mt-1.5 text-sm leading-relaxed">
                  {group.description}
                </p>
              </div>
              <div className="inv-surface-subtle inv-mono shrink-0 px-3 py-1.5 text-xs font-semibold">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--inv-border)] pt-4">
              {user && (
                <Link
                  href={`/share?group=${group.slug}`}
                  className="inv-btn-primary px-4 py-2 text-xs sm:text-sm"
                >
                  + Share to this group
                </Link>
              )}
              {user && !meRow && group.visibility === "public" && (
                <form action={joinGroup}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <button type="submit" className="inv-btn-secondary px-4 py-2 text-xs sm:text-sm">
                    Join community
                  </button>
                </form>
              )}
              {meRow && (
                <form action={toggleMute}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="muted" value={String(meRow.muted)} />
                  <button type="submit" className="inv-btn-secondary px-4 py-2 text-xs sm:text-sm">
                    {meRow.muted
                      ? "🔕 Muted: turn notifications on"
                      : "🔔 Notifications on: mute"}
                  </button>
                </form>
              )}
              {meRow && meRow.role !== "owner" && (
                <form action={leaveGroup} className="ml-auto">
                  <input type="hidden" name="groupId" value={group.id} />
                  <button
                    type="submit"
                    className="inv-nav-link px-3 py-2 text-xs font-semibold text-[var(--inv-blocked-text)]"
                  >
                    Leave
                  </button>
                </form>
              )}
            </div>
          </header>

          {feed.length === 0 ? (
            <EmptyState
              title="Nothing shared here yet"
              hint="Be the first to post a quality-checked event to this group."
            >
              {user && (
                <Link
                  href={`/share?group=${group.slug}`}
                  className="inv-btn-primary px-4 py-2 text-sm"
                >
                  Share an event
                </Link>
              )}
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {feed.map((i) => (
                <InviteCard key={i.id} invite={i} />
              ))}
            </div>
          )}
        </div>

        {/* Members Sidebar */}
        <aside className="space-y-4">
          <section className="inv-card p-5">
            <div className="flex items-center justify-between border-b border-[var(--inv-border)] pb-3">
              <h2 className="inv-heading text-base font-bold">{memberCount} members</h2>
              <span className="inv-kicker">Directory</span>
            </div>
            <ul className="mt-3 max-h-80 space-y-2.5 overflow-auto text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/people/${m.handle}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <Avatar name={m.displayName} size={26} />
                    <span className="truncate font-medium">
                      {m.displayName}{" "}
                      <span className="inv-mono text-xs inv-text-muted">@{m.handle}</span>
                    </span>
                  </Link>
                  {isOwner && m.id !== user?.id ? (
                    <form action={removeMember}>
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="userId" value={m.id} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-[var(--inv-blocked-text)] hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  ) : m.role === "owner" ? (
                    <span className="inv-chip inv-mono px-2 py-0.5 text-[10px] uppercase">
                      owner
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {memberCount > members.length && (
              <p className="inv-text-muted mt-3 border-t border-[var(--inv-border)] pt-2 text-xs">
                Showing first {members.length} members.
              </p>
            )}
          </section>

          {isOwner && (
            <form action={addMembers} className="inv-card space-y-3 p-5">
              <input type="hidden" name="groupId" value={group.id} />
              <div>
                <span className="inv-kicker">Invite by handle</span>
                <label className="inv-heading block text-base font-bold" htmlFor="handles">
                  Add people
                </label>
              </div>
              <input
                id="handles"
                name="handles"
                placeholder="@ada, @maya"
                className="inv-input w-full px-3 py-2 text-sm"
              />
              <button type="submit" className="inv-btn-ink w-full px-3 py-2 text-sm">
                Add to group
              </button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
