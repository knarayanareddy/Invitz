import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import Link from "next/link";
import { saveInterests } from "@/app/actions/settings";
import { toggleFollow } from "@/app/actions/social";
import { db } from "@/db";
import { follows, invites, topics, userInterests, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const allTopics = await db.select().from(topics).orderBy(topics.name);
  const myTopicIds = new Set(
    (await db.select({ id: userInterests.topicId }).from(userInterests).where(eq(userInterests.userId, user.id))).map(
      (r) => r.id,
    ),
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
    (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id))).map(
      (r) => r.id,
    ),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome to Invitz</h1>
          <p className="text-sm text-stone-600">Three quick steps to tailor your event feed.</p>
        </div>
        <Link href="/" className="text-sm text-violet-700 hover:underline">
          Skip to feed →
        </Link>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">1. How quality checks work</h2>
        <p className="mt-1 text-sm text-stone-600">
          Every shared link goes through deterministic safety rules and AI event verification before anyone is notified:
        </p>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
            <p className="font-semibold">Verified</p>
            <p className="mt-0.5">Real event signals confirmed. Delivered to opted-in channels.</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">Proceed with caution</p>
            <p className="mt-0.5">Unverifiable or weak signals. Visible in feed, skipped by default on external channels.</p>
          </div>
          <div className="rounded-lg bg-rose-50 p-3 text-rose-900 ring-1 ring-rose-200">
            <p className="font-semibold">Blocked</p>
            <p className="mt-0.5">Fails spam, scam, or security rules and never reaches communities.</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">2. Pick your communities</h2>
        <p className="mt-1 text-sm text-stone-600">Select one or more topics to auto-join matching public communities.</p>
        <form action={saveInterests} className="mt-4 space-y-4">
          <input type="hidden" name="redirectTo" value="/onboarding" />
          <div className="flex flex-wrap gap-2">
            {allTopics.map((t) => (
              <label key={t.id} className="cursor-pointer">
                <input type="checkbox" name="topic" value={t.id} defaultChecked={myTopicIds.has(t.id)} className="peer sr-only" />
                <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1.5 text-sm peer-checked:border-violet-600 peer-checked:bg-violet-600 peer-checked:text-white">
                  {t.emoji} {t.name}
                </span>
              </label>
            ))}
          </div>
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
            Save communities
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">3. Connect notifications & follow curators</h2>
        <p className="mt-1 text-sm text-stone-600">
          By default, external channels (Discord, WhatsApp, Signal) only send <strong>Verified</strong> invites.{" "}
          <Link href="/settings" className="text-violet-700 hover:underline">
            Connect a channel in Settings →
          </Link>
        </p>
        {curators.length > 0 && (
          <ul className="mt-4 divide-y divide-stone-100">
            {curators.map((c) => {
              const isFollowing = followingSet.has(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={`/people/${c.handle}`} className="font-medium hover:underline">
                      {c.displayName} <span className="text-stone-500">@{c.handle}</span>
                    </Link>
                    {c.headline && <p className="truncate text-xs text-stone-500">{c.headline}</p>}
                  </div>
                  <form action={toggleFollow}>
                    <input type="hidden" name="userId" value={c.id} />
                    <input type="hidden" name="handle" value={c.handle} />
                    <input type="hidden" name="following" value={String(isFollowing)} />
                    <button className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium hover:bg-stone-50">
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
