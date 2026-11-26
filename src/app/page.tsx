import Link from "next/link";
import { EmptyState, InviteCard } from "@/components/invite-card";
import { getCurrentUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "mine", label: "My communities" },
  { key: "following", label: "Following" },
] as const;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await ensureBootstrap();
  const { tab: rawTab } = await searchParams;
  const user = await getCurrentUser();
  const tab = TABS.find((t) => t.key === rawTab)?.key ?? "all";
  const feed = await getFeed({ viewerId: user?.id ?? null, tab });

  return (
    <div className="space-y-6">
      {!user && (
        <section className="rounded-3xl bg-gradient-to-br from-violet-600 via-violet-600 to-fuchsia-500 p-8 text-white shadow-lg sm:p-12">
          <h1 className="max-w-xl text-3xl font-bold leading-tight sm:text-4xl">Share events worth going to. Skip the spam.</h1>
          <p className="mt-3 max-w-xl text-violet-100">
            Drop any event link into the right community — ML engineers, founders, climate folks, VCs, or your own private circle.
            Every share is quality-checked before anyone is pinged.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/login" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50">
              Get started
            </Link>
            <Link href="/guidelines" className="rounded-lg bg-white/15 px-5 py-2.5 text-sm font-medium hover:bg-white/25">
              How QC works
            </Link>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{user ? "Your feed" : "Happening now on Invitz"}</h2>
        {user && (
          <div className="flex gap-1 rounded-lg bg-stone-200/70 p-1 text-sm">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.key === "all" ? "/" : `/?tab=${t.key}`}
                className={`rounded-md px-3 py-1 ${tab === t.key ? "bg-white font-medium shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {feed.length === 0 ? (
        <EmptyState
          title={tab === "following" ? "Nobody you follow has shared yet" : "No invites here yet"}
          hint={tab === "following" ? "Follow people from the People page to see their invites." : "Be the first to share an event."}
        >
          <Link href={user ? "/share" : "/login"} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">
            Share an event
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-4">{feed.map((i) => <InviteCard key={i.id} invite={i} />)}</div>
      )}
    </div>
  );
}
