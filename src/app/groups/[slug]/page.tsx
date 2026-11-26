import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addMembers, joinGroup, leaveGroup, removeMember, toggleMute } from "@/app/actions/groups";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { EmptyState, InviteCard } from "@/components/invite-card";
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
    .select({ id: users.id, handle: users.handle, displayName: users.displayName, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, group.id))
    .limit(200);

  const feed = await getFeed({ viewerId: user?.id ?? null, groupId: group.id });
  const isOwner = group.ownerId === user?.id;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <div className="space-y-5">
        {warn && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{warn}</p>}
        <header className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-stone-500">{group.type} group · {group.visibility}</p>
          <h1 className="mt-1 text-2xl font-bold">{group.name}</h1>
          <p className="mt-1 text-sm text-stone-600">{group.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {user && (
              <Link href={`/share?group=${group.slug}`} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
                Share to this group
              </Link>
            )}
            {user && !meRow && group.visibility === "public" && (
              <form action={joinGroup}>
                <input type="hidden" name="groupId" value={group.id} />
                <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50">Join</button>
              </form>
            )}
            {meRow && (
              <form action={toggleMute}>
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="muted" value={String(meRow.muted)} />
                <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">
                  {meRow.muted ? "🔕 Muted: turn notifications on" : "🔔 Notifications on: mute"}
                </button>
              </form>
            )}
            {meRow && meRow.role !== "owner" && (
              <form action={leaveGroup}>
                <input type="hidden" name="groupId" value={group.id} />
                <button className="rounded-lg px-4 py-2 text-sm text-rose-600 hover:bg-rose-50">Leave</button>
              </form>
            )}
          </div>
        </header>

        {feed.length === 0 ? (
          <EmptyState title="Nothing shared here yet" hint="Be the first to post an event to this group." />
        ) : (
          feed.map((i) => <InviteCard key={i.id} invite={i} />)
        )}
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">{memberCount} members</h2>
          <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <Link href={`/people/${m.handle}`} className="truncate hover:underline">
                  {m.displayName} <span className="text-stone-500">@{m.handle}</span>
                </Link>
                {isOwner && m.id !== user?.id ? (
                  <form action={removeMember}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="userId" value={m.id} />
                    <button className="text-xs text-rose-600 hover:underline">Remove</button>
                  </form>
                ) : m.role === "owner" ? (
                  <span className="text-xs text-stone-500">owner</span>
                ) : null}
              </li>
            ))}
          </ul>
          {memberCount > members.length && (
            <p className="mt-2 text-xs text-stone-500">Showing first {members.length} members.</p>
          )}
        </section>
        {isOwner && (
          <form action={addMembers} className="space-y-2 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <input type="hidden" name="groupId" value={group.id} />
            <label className="text-sm font-semibold" htmlFor="handles">Add people</label>
            <input id="handles" name="handles" placeholder="@ada, @maya" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            <button className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white">Add</button>
          </form>
        )}
      </aside>
    </div>
  );
}
