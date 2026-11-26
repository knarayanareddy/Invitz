import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleBell, toggleFollow } from "@/app/actions/social";
import { Avatar, EmptyState, InviteCard } from "@/components/invite-card";
import { db } from "@/db";
import { follows, topics, userInterests, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const [person] = await db
    .select()
    .from(users)
    .where(eq(users.handle, handle.toLowerCase()))
    .limit(1);
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
    .select({ name: topics.name, emoji: topics.emoji, slug: topics.slug })
    .from(userInterests)
    .innerJoin(topics, eq(topics.id, userInterests.topicId))
    .where(eq(userInterests.userId, person.id));

  const [follow] = me
    ? await db
        .select()
        .from(follows)
        .where(and(eq(follows.followerId, me.id), eq(follows.followeeId, person.id)))
        .limit(1)
    : [];

  const feed = await getFeed({ viewerId: me?.id ?? null, sharerId: person.id });
  const isMe = me?.id === person.id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/people" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
          ← All curators
        </Link>
        <span className="inv-kicker">Curator Profile</span>
      </div>

      <header className="inv-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Avatar name={person.displayName} image={person.image} size={68} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="inv-heading text-2xl font-bold sm:text-3xl">
                  {person.displayName}
                </h1>
                <span className="inv-chip-accent inv-mono px-2.5 py-0.5 text-xs font-semibold">
                  trust score {person.trustScore}
                </span>
              </div>
              <p className="inv-mono mt-0.5 text-sm inv-text-muted">@{person.handle}</p>
              {person.headline && (
                <p className="inv-text-secondary mt-1.5 text-sm font-medium">
                  {person.headline}
                </p>
              )}
            </div>
          </div>

          {me && !isMe && (
            <div className="flex flex-wrap items-center gap-2">
              {follow && (
                <form action={toggleBell}>
                  <input type="hidden" name="handle" value={person.handle} />
                  <input type="hidden" name="notify" value={String(follow.notify)} />
                  <button
                    type="submit"
                    className="inv-btn-secondary px-3.5 py-2 text-xs sm:text-sm"
                  >
                    {follow.notify ? "🔔 Notifying me" : "🔕 Notifications off"}
                  </button>
                </form>
              )}
              <form action={toggleFollow}>
                <input type="hidden" name="handle" value={person.handle} />
                <button
                  type="submit"
                  className={`px-4 py-2 text-xs sm:text-sm ${
                    follow ? "inv-btn-secondary" : "inv-btn-primary"
                  }`}
                >
                  {follow ? "Following" : "Follow"}
                </button>
              </form>
            </div>
          )}

          {isMe && (
            <Link href="/settings" className="inv-btn-secondary px-4 py-2 text-xs sm:text-sm">
              Edit profile
            </Link>
          )}
        </div>

        {person.bio && (
          <p className="inv-text-secondary mt-4 text-sm leading-relaxed">
            {person.bio}
          </p>
        )}

        {interests.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {interests.map((i) => (
              <Link
                key={i.name}
                href={`/groups/${i.slug}`}
                className="inv-chip px-3 py-1 text-xs font-medium"
              >
                {i.emoji} {i.name}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-[var(--inv-border)] pt-4 text-sm">
          <span>
            <strong className="inv-mono">{counts.followers}</strong>{" "}
            <span className="inv-text-muted">followers</span>
          </span>
          <span>
            <strong className="inv-mono">{counts.following}</strong>{" "}
            <span className="inv-text-muted">following</span>
          </span>
          <span>
            <strong className="inv-mono">{feed.length}</strong>{" "}
            <span className="inv-text-muted">public invites</span>
          </span>
        </div>
      </header>

      <div className="flex items-baseline justify-between border-b border-[var(--inv-border)] pb-3">
        <h2 className="inv-heading text-xl font-bold">Shared invites</h2>
        <span className="inv-kicker">Quality-checked dispatch</span>
      </div>

      {feed.length === 0 ? (
        <EmptyState title="No public invites yet" hint={`@${person.handle} hasn’t shared any public invites yet.`} />
      ) : (
        <div className="space-y-4">
          {feed.map((i) => (
            <InviteCard key={i.id} invite={i} />
          ))}
        </div>
      )}
    </div>
  );
}
