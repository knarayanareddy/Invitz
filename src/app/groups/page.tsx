import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { createGroup } from "@/app/actions/groups";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await getCurrentUser();
  const rows = await db
    .select({
      id: groups.id, slug: groups.slug, name: groups.name, description: groups.description,
      type: groups.type, visibility: groups.visibility,
      members: sql<number>`(select count(*)::int from group_members gm where gm.group_id = ${groups.id})`,
    })
    .from(groups)
    .orderBy(groups.name);
  const mine = user
    ? new Set((await db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, user.id))).map((m) => m.id))
    : new Set<string>();

  const visible = rows.filter((g) => g.visibility === "public" || mine.has(g.id));
  const sections = [
    { title: "Wide audience", items: visible.filter((g) => g.type === "general") },
    { title: "Communities", items: visible.filter((g) => g.type === "topic") },
    { title: "Custom groups", items: visible.filter((g) => g.type === "custom") },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Groups</h1>
        <p className="mt-1 text-sm text-stone-600">Choose the audiences you care about, or create a private circle of your own.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

      {sections.map((s) =>
        s.items.length === 0 ? null : (
          <section key={s.title}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">{s.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {s.items.map((g) => (
                <Link key={g.id} href={`/groups/${g.slug}`} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-violet-300">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{g.name}</h3>
                    {mine.has(g.id) && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">Joined</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-stone-600">{g.description}</p>
                  <p className="mt-2 text-xs text-stone-500">{g.members} members · {g.visibility}</p>
                </Link>
              ))}
            </div>
          </section>
        ),
      )}

      {user ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Create a custom group</h2>
          <form action={createGroup} className="mt-4 space-y-3">
            <input name="name" aria-label="Group name" required minLength={3} maxLength={50} placeholder="Group name (e.g. Berlin AI dinner crew)" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            <input name="description" aria-label="Group description" maxLength={300} placeholder="What is this group for?" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            <input name="members" aria-label="Initial member handles" placeholder="Add people by @handle, comma separated (optional)" className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="visibility" value="private" defaultChecked /> Private (members only)</label>
              <label className="flex items-center gap-2"><input type="radio" name="visibility" value="public" /> Public (anyone can join)</label>
              <button className="ml-auto rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700">Create group</button>
            </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-stone-600"><Link href="/login" className="font-medium text-violet-700 underline">Sign in</Link> to join or create groups.</p>
      )}
    </div>
  );
}
