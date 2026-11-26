import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { ShareForm } from "@/components/share-form";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SharePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const user = await requireUser();
  const { group } = await searchParams;
  const all = await db.select().from(groups).where(inArray(groups.type, ["general", "topic"])).orderBy(asc(groups.name));
  const mine = await db
    .select({ id: groups.id, name: groups.name, slug: groups.slug, type: groups.type, description: groups.description })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, user.id));
  const custom = mine.filter((g) => g.type === "custom");
  const pre = [...all, ...custom].filter((g) => g.slug === group).map((g) => g.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Share an event</h1>
        <p className="mt-1 text-sm text-stone-600">Any link, any platform, any organiser. Pick who it’s for.</p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <ShareForm
          everyone={all.filter((g) => g.type === "general")}
          topics={all.filter((g) => g.type === "topic")}
          mine={custom}
          preselect={pre}
        />
      </div>
    </div>
  );
}
