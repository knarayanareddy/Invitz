import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleBell, toggleFollow } from "@/app/actions/social";
import { db } from "@/db";
import { follows, topics, userInterests, users } from "@/db/schema";
import { Avatar, EmptyState, InviteCard } from "@/components/invite-card";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [person] = await db.select().from(users).where(eq(users.handle, handle.toLowerCase())).limit(1);
  if (!person) notFound();
  const me = await getCurrentUser();

  const [counts] = await db
    .select({
      followers: sql<number>`(select count(*)::int from follows where followee_id = ${person.id})`,
      following: sql<number>`(select count(*)::int from follows where follower_id = ${person.id})`,
    })
    .from(users)
    .where(eq(users.id, person.id));
  const interests = await db
    .select({ name: topics.name, emoji: topics.emoji })
    .from(userInterests)
    .innerJoin(topics, eq(topics.id, userInterests.topicId))
    .where(eq(userInterests.userId, person.id));
  const [follow] = me
    ? await db.select().from(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, person.id))).limit(1)
    : [];
  const feed = await getFeed({ viewerId: me?.id ?? null, sharerId: person.id });
  const isMe = me?.id === person.id;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <Avatar name={person.displayName} image={person.image} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{person.displayName}</h1>
            <p className="text-sm text-stone-500">@{person.handle} · trust score {person.trustScore}</p>
            {person.headline && <p className="mt-1 text-sm text-stone-700">{person.headline}</p>}
          </div>
        </div>
        {person.bio && <p className="mt-4 text-sm text-stone-700">{person.bio}</p>}
        {interests.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {interests.map((i) => (
              <span key={i.name} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700">{i.emoji} {i.name}</span>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span><b>{counts.followers}</b> followers</span>
          <span><b>{counts.following}</b> following</span>
          {me && !isMe && (
            <div className="ml-auto flex gap-2">
              {follow && (
                <form action={toggleBell}>
                  <input type="hidden" name="handle" value={person.handle} />
                  <input type="hidden" name="notify" value={String(follow.notify)} />
                  <button className="rounded-lg border border-stone-300 px-3 py-2 hover:bg-stone-50">
                    {follow.notify ? "🔔 Notifying me" : "🔕 Notifications off"}
                  </button>
                </form>
              )}
              <form action={toggleFollow}>
                <input type="hidden" name="handle" value={person.handle} />
                <button className={`rounded-lg px-4 py-2 font-medium ${follow ? "border border-stone-300 hover:bg-stone-50" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
                  {follow ? "Following" : "Follow"}
                </button>
              </form>
            </div>
          )}
          {isMe && <Link href="/settings" className="ml-auto rounded-lg border border-stone-300 px-4 py-2 hover:bg-stone-50">Edit profile</Link>}
        </div>
      </header>

      <h2 className="text-lg font-semibold">Shared invites</h2>
      {feed.length === 0 ? <EmptyState title="No public invites yet" /> : feed.map((i) => <InviteCard key={i.id} invite={i} />)}
    </div>
  );
}
