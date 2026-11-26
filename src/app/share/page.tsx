import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { ShareForm } from "@/components/share-form";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const user = await requireUser();
  const { group } = await searchParams;
  const all = await db
    .select()
    .from(groups)
    .where(inArray(groups.type, ["general", "topic"]))
    .orderBy(asc(groups.name));
  const mine = await db
    .select({
      id: groups.id,
      name: groups.name,
      slug: groups.slug,
      type: groups.type,
      description: groups.description,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, user.id));
  const custom = mine.filter((g) => g.type === "custom");
  const pre = [...all, ...custom].filter((g) => g.slug === group).map((g) => g.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inv-kicker">Event Curation Composer</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">Share an event</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            Any link, any platform, any organiser. Pick the communities that will value it most.
          </p>
        </div>
        <Link href="/guidelines" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
          QC Rulebook →
        </Link>
      </div>

      <div className="inv-card p-6 sm:p-8">
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
