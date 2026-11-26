import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { saveInterests } from "@/app/actions/settings";
import { toggleFollow } from "@/app/actions/social";
import { Avatar } from "@/components/invite-card";
import { db } from "@/db";
import { follows, invites, topics, userInterests, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const allTopics = await db.select().from(topics).orderBy(topics.name);
  const myTopicIds = new Set(
    (
      await db
        .select({ id: userInterests.topicId })
        .from(userInterests)
        .where(eq(userInterests.userId, user.id))
    ).map((r) => r.id),
  );

  const curators = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      headline: users.headline,
      verifiedCount: sql<number>`count(${invites.id})::int`,
    })
    .from(users)
    .leftJoin(
      invites,
      and(
        eq(invites.sharedById, users.id),
        eq(invites.verdict, "verified"),
        eq(invites.status, "published"),
        gte(invites.createdAt, sql`now() - interval '30 days'`),
      ),
    )
    .where(ne(users.id, user.id))
    .groupBy(users.id)
    .orderBy(desc(sql`count(${invites.id})`), desc(users.trustScore))
    .limit(5);

  const followingSet = new Set(
    (
      await db
        .select({ id: follows.followeeId })
        .from(follows)
        .where(eq(follows.followerId, user.id))
    ).map((r) => r.id),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">3-Step Setup</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">Welcome to Invitz</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            Three quick steps to tailor your event feed and notification preferences.
          </p>
        </div>
        <Link href="/" className="inv-btn-secondary px-4 py-2 text-xs sm:text-sm">
          Skip to feed →
        </Link>
      </div>

      {/* Step 1 */}
      <section className="inv-card p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <span className="inv-btn-primary inv-mono grid h-6 w-6 place-items-center text-xs font-bold">
            01
          </span>
          <h2 className="inv-heading text-lg font-bold">1. How quality checks work</h2>
        </div>
        <p className="inv-text-secondary mt-2 text-sm">
          Every shared link goes through deterministic safety rules and AI event verification before
          anyone is notified:
        </p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div className="inv-verdict-verified p-3.5" style={{ borderRadius: "var(--inv-radius-input)" }}>
            <p className="font-bold">✓ Verified</p>
            <p className="mt-1 opacity-90">
              Real event signals confirmed. Delivered to opted-in channels.
            </p>
          </div>
          <div className="inv-verdict-caution p-3.5" style={{ borderRadius: "var(--inv-radius-input)" }}>
            <p className="font-bold">! Proceed with caution</p>
            <p className="mt-1 opacity-90">
              Unverifiable or weak signals. Visible in feed, skipped by default on external channels.
            </p>
          </div>
          <div className="inv-verdict-rejected p-3.5" style={{ borderRadius: "var(--inv-radius-input)" }}>
            <p className="font-bold">✕ Blocked</p>
            <p className="mt-1 opacity-90">
              Fails spam, scam, or security rules and never reaches communities.
            </p>
          </div>
        </div>
      </section>

      {/* Step 2 */}
      <section className="inv-card p-6 sm:p-7">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inv-btn-primary inv-mono grid h-6 w-6 place-items-center text-xs font-bold">
              02
            </span>
            <h2 className="inv-heading text-lg font-bold">2. Pick your communities</h2>
          </div>
          <span className="inv-mono text-xs inv-text-muted">
            {myTopicIds.size} joined
          </span>
        </div>
        <p className="inv-text-secondary mt-2 text-sm">
          Select one or more topics to auto-join matching public communities.
        </p>
        <form action={saveInterests} className="mt-4 space-y-4">
          <input type="hidden" name="redirectTo" value="/onboarding" />
          <div className="flex flex-wrap gap-2">
            {allTopics.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="topic"
                  value={t.id}
                  defaultChecked={myTopicIds.has(t.id)}
                  className="peer sr-only"
                />
                <span className="inv-chip inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium peer-checked:border-[var(--inv-accent)] peer-checked:bg-[var(--inv-accent)] peer-checked:text-[var(--inv-accent-contrast)]">
                  <span>{t.emoji}</span>
                  <span>{t.name}</span>
                </span>
              </label>
            ))}
          </div>
          <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
            Save communities
          </button>
        </form>
      </section>

      {/* Step 3 */}
      <section className="inv-card p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <span className="inv-btn-primary inv-mono grid h-6 w-6 place-items-center text-xs font-bold">
            03
          </span>
          <h2 className="inv-heading text-lg font-bold">
            3. Connect notifications &amp; follow curators
          </h2>
        </div>
        <p className="inv-text-secondary mt-2 text-sm">
          By default, external channels (Discord, WhatsApp, Signal) only send{" "}
          <strong>Verified</strong> invites.{" "}
          <Link href="/settings" className="font-semibold text-[var(--inv-accent)] underline">
            Connect a channel in Settings →
          </Link>
        </p>

        {curators.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--inv-border)]">
            {curators.map((c) => {
              const isFollowing = followingSet.has(c.id);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={c.displayName} size={34} />
                    <div className="min-w-0">
                      <Link
                        href={`/people/${c.handle}`}
                        className="font-semibold hover:underline"
                      >
                        {c.displayName}{" "}
                        <span className="inv-mono text-xs font-normal inv-text-muted">
                          @{c.handle}
                        </span>
                      </Link>
                      {c.headline && (
                        <p className="inv-text-muted truncate text-xs">{c.headline}</p>
                      )}
                    </div>
                  </div>
                  <form action={toggleFollow}>
                    <input type="hidden" name="userId" value={c.id} />
                    <input type="hidden" name="handle" value={c.handle} />
                    <input type="hidden" name="following" value={String(isFollowing)} />
                    <button
                      type="submit"
                      className={`px-3.5 py-1.5 text-xs ${
                        isFollowing ? "inv-btn-secondary" : "inv-btn-primary"
                      }`}
                    >
                      {isFollowing ? "Following" : "Follow"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
