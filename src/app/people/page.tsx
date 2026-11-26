import { ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Avatar } from "@/components/invite-card";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = q?.trim().slice(0, 40);
  const rows = await db
    .select({
      id: users.id, handle: users.handle, displayName: users.displayName, headline: users.headline, trustScore: users.trustScore,
      shares: sql<number>`(select count(*)::int from invites i where i.shared_by_id = ${users.id} and i.status = 'published')`,
    })
    .from(users)
    .where(term ? or(ilike(users.handle, `%${term}%`), ilike(users.displayName, `%${term}%`)) : undefined)
    .orderBy(users.displayName)
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">People</h1>
        <p className="mt-1 text-sm text-stone-600">Follow curators you trust and get notified when they share an event.</p>
      </div>
      <form className="flex gap-2">
        <input name="q" aria-label="Search people by name or handle" defaultValue={term} placeholder="Search by name or @handle" className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
        <button className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((u) => (
          <Link key={u.id} href={`/people/${u.handle}`} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-violet-300">
            <Avatar name={u.displayName} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{u.displayName} <span className="font-normal text-stone-500">@{u.handle}</span></p>
              <p className="truncate text-sm text-stone-600">{u.headline || "No headline yet"}</p>
              <p className="text-xs text-stone-500">{u.shares} invites shared · trust {u.trustScore}</p>
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p className="text-sm text-stone-600">No one matches that search.</p>}
      </div>
    </div>
  );
}
