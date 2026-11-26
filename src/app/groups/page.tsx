import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { createGroup } from "@/app/actions/groups";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await getCurrentUser();
  const rows = await db
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      type: groups.type,
      visibility: groups.visibility,
      members: sql<number>`(select count(*)::int from group_members gm where gm.group_id = ${groups.id})`,
    })
    .from(groups)
    .orderBy(groups.name);

  const mine = user
    ? new Set(
        (
          await db
            .select({ id: groupMembers.groupId })
            .from(groupMembers)
            .where(eq(groupMembers.userId, user.id))
        ).map((m) => m.id),
      )
    : new Set<string>();

  const visible = rows.filter((g) => g.visibility === "public" || mine.has(g.id));
  const sections = [
    {
      title: "Wide audience",
      kicker: "Open to everyone",
      items: visible.filter((g) => g.type === "general"),
    },
    {
      title: "Communities",
      kicker: "Curated Topic Guilds",
      items: visible.filter((g) => g.type === "topic"),
    },
    {
      title: "Custom groups",
      kicker: "Public & private circles",
      items: visible.filter((g) => g.type === "custom"),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">Audience Directory</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">Groups &amp; Communities</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            Choose the audiences you care about, or create a private circle of your own.
          </p>
        </div>
        {user && (
          <Link href="/share" className="inv-btn-primary px-4 py-2 text-xs sm:text-sm">
            + Share to a group
          </Link>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="inv-verdict-rejected px-4 py-3 text-sm font-medium"
          style={{ borderRadius: "var(--inv-radius-input)" }}
        >
          {error}
        </p>
      )}

      {sections.map((s) =>
        s.items.length === 0 ? null : (
          <section key={s.title} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="inv-heading text-xl font-bold">{s.title}</h2>
              <span className="inv-kicker">{s.kicker}</span>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              {s.items.map((g) => {
                const isJoined = mine.has(g.id);
                return (
                  <Link
                    key={g.id}
                    href={`/groups/${g.slug}`}
                    className="inv-card inv-card-interactive flex flex-col justify-between p-5"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="inv-heading text-lg font-bold">#{g.name}</h3>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {g.visibility === "private" && (
                            <span className="inv-chip inv-mono px-2.5 py-0.5 text-[10px] uppercase">
                              🔒 private
                            </span>
                          )}
                          {isJoined && (
                            <span className="inv-chip-accent px-2.5 py-0.5 text-xs font-semibold">
                              Joined
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="inv-text-secondary mt-1.5 line-clamp-2 text-sm leading-relaxed">
                        {g.description}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--inv-border)] pt-3 text-xs inv-text-muted">
                      <span className="inv-mono">
                        {g.members} {g.members === 1 ? "member" : "members"} · {g.visibility}
                      </span>
                      <span className="font-semibold text-[var(--inv-ink)]">View feed →</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ),
      )}

      {user ? (
        <section className="inv-card p-6 sm:p-7">
          <span className="inv-kicker">New Circle</span>
          <h2 className="inv-heading mt-0.5 text-xl font-bold">Create a custom group</h2>
          <p className="inv-text-muted mt-1 text-xs sm:text-sm">
            Start a private dinner circle, local city chapter, or public working group.
          </p>
          <form action={createGroup} className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="group-name" className="block text-xs font-semibold inv-text-secondary">
                  Group name
                </label>
                <input
                  id="group-name"
                  name="name"
                  aria-label="Group name"
                  required
                  minLength={3}
                  maxLength={50}
                  placeholder="Group name (e.g. Berlin AI dinner crew)"
                  className="inv-input w-full px-3.5 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="group-members" className="block text-xs font-semibold inv-text-secondary">
                  Initial members <span className="font-normal inv-text-muted">(optional)</span>
                </label>
                <input
                  id="group-members"
                  name="members"
                  aria-label="Initial member handles"
                  placeholder="Add people by @handle, comma separated (optional)"
                  className="inv-input w-full px-3.5 py-2 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="group-description" className="block text-xs font-semibold inv-text-secondary">
                Description
              </label>
              <input
                id="group-description"
                name="description"
                aria-label="Group description"
                maxLength={300}
                placeholder="What is this group for?"
                className="inv-input w-full px-3.5 py-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--inv-border)] pt-4 text-sm">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    defaultChecked
                    className="accent-[var(--inv-accent)]"
                  />
                  <span>Private (members only)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    className="accent-[var(--inv-accent)]"
                  />
                  <span>Public (anyone can join)</span>
                </label>
              </div>
              <button type="submit" className="inv-btn-primary px-5 py-2 text-sm">
                Create group
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="inv-surface-subtle p-5 text-center text-sm inv-text-secondary">
          <Link href="/login" className="font-semibold text-[var(--inv-accent)] underline">
            Sign in
          </Link>{" "}
          to join topic communities or create custom private groups.
        </div>
      )}
    </div>
  );
}
