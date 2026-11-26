import { ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Avatar, EmptyState } from "@/components/invite-card";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = q?.trim().slice(0, 40);
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      headline: users.headline,
      trustScore: users.trustScore,
      image: users.image,
      shares: sql<number>`(select count(*)::int from invites i where i.shared_by_id = ${users.id} and i.status = 'published')`,
    })
    .from(users)
    .where(
      term
        ? or(ilike(users.handle, `%${term}%`), ilike(users.displayName, `%${term}%`))
        : undefined,
    )
    .orderBy(users.displayName)
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">Curator Network</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">People</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            Follow curators you trust and turn on notifications when they share a verified event.
          </p>
        </div>
        <span className="inv-mono text-xs inv-text-muted">
          {rows.length} {rows.length === 1 ? "curator" : "curators"}
        </span>
      </div>

      <form className="flex flex-wrap gap-2">
        <input
          name="q"
          aria-label="Search people by name or handle"
          defaultValue={term}
          placeholder="Search by name or @handle…"
          className="inv-input min-w-56 flex-1 px-4 py-2.5 text-sm"
        />
        {term && (
          <Link href="/people" className="inv-btn-secondary px-4 py-2.5 text-sm">
            Clear
          </Link>
        )}
        <button type="submit" className="inv-btn-ink px-5 py-2.5 text-sm">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No one matches that search"
          hint={term ? `No curators found matching “${term}”.` : "No curators registered yet."}
        >
          {term && (
            <Link href="/people" className="inv-btn-secondary px-4 py-2 text-sm">
              Show all curators
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {rows.map((u) => (
            <Link
              key={u.id}
              href={`/people/${u.handle}`}
              className="inv-card inv-card-interactive flex items-start gap-4 p-5"
            >
              <Avatar name={u.displayName} image={u.image} size={48} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate font-bold text-[var(--inv-ink)]">
                    {u.displayName}
                  </p>
                  <span className="inv-chip-accent inv-mono shrink-0 px-2.5 py-0.5 text-[11px] font-semibold">
                    trust {u.trustScore}
                  </span>
                </div>
                <p className="inv-mono text-xs inv-text-muted">@{u.handle}</p>
                <p className="inv-text-secondary mt-1.5 line-clamp-1 text-sm">
                  {u.headline || "Event curator on Invitz"}
                </p>
                <p className="inv-mono mt-2.5 text-xs inv-text-muted">
                  {u.shares} {u.shares === 1 ? "invite" : "invites"} shared
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
