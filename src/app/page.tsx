import { eq } from "drizzle-orm";
import Link from "next/link";
import { loginAsDemo } from "@/app/actions/auth";
import { EmptyState, InviteCard } from "@/components/invite-card";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "mine", label: "My communities" },
  { key: "following", label: "Following" },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await ensureBootstrap();
  const { tab: rawTab } = await searchParams;
  const user = await getCurrentUser();
  const tab = TABS.find((t) => t.key === rawTab)?.key ?? "all";

  const [feed, topicGroups] = await Promise.all([
    getFeed({ viewerId: user?.id ?? null, tab }),
    db.select().from(groups).where(eq(groups.type, "topic")).orderBy(groups.name),
  ]);

  const verifiedCount = feed.filter((i) => i.verdict === "verified").length;

  return (
    <div className="space-y-8">
      {/* Signed-out Hero & QC Trust Architecture Preview */}
      {!user && (
        <section className="inv-hero p-6 sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2">
                <span className="inv-chip-accent inv-mono px-3 py-1 text-xs font-semibold">
                  PLATFORM-AGNOSTIC · QC-VERIFIED
                </span>
                <span className="inv-kicker hidden sm:inline">
                  Zero platform lock-in
                </span>
              </div>

              <h1 className="inv-heading text-3xl font-bold leading-tight sm:text-5xl">
                Share events worth going to. Skip the spam.
              </h1>

              <p className="inv-text-secondary max-w-xl text-sm leading-relaxed sm:text-base">
                Drop any event link—from Luma, Eventbrite, university labs, or independent sites—into
                curated topic communities or private circles. Every link passes deterministic safety
                rules and AI verification <strong>before</strong> anyone is pinged.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {process.env.INVITZ_DEMO_SEED === "true" ? (
                  <form action={loginAsDemo}>
                    <input type="hidden" name="handle" value="ada" />
                    <input type="hidden" name="next" value="/settings" />
                    <button type="submit" className="inv-btn-primary px-5 py-2.5 text-sm">
                      Try live demo (@ada)
                    </button>
                  </form>
                ) : (
                  <Link href="/login" className="inv-btn-primary px-5 py-2.5 text-sm">
                    Get started
                  </Link>
                )}
                <Link
                  href="/guidelines"
                  className="inv-btn-secondary px-4 py-2.5 text-sm"
                >
                  How QC works
                </Link>
                <Link
                  href="/groups"
                  className="inv-chip px-3.5 py-2 text-xs font-semibold"
                >
                  Browse communities
                </Link>
              </div>
            </div>

            {/* Visual Trust Pipeline Inspector Card */}
            <div className="inv-card space-y-3 p-4 sm:p-5">
              <div className="flex items-center justify-between border-b border-[var(--inv-border)] pb-2.5">
                <span className="inv-kicker">Pre-notification QC Engine</span>
                <span className="inv-mono text-[11px] inv-text-muted">16 active checks</span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="inv-verdict-verified flex items-start justify-between gap-2 p-2.5">
                  <div>
                    <p className="font-semibold">✓ Verified · 93% confidence</p>
                    <p className="mt-0.5 opacity-85">
                      Real venue, date &amp; organiser confirmed. Pushed via Discord, Telegram, WhatsApp, Signal &amp; E-mail with digests &amp; quiet hours.
                    </p>
                  </div>
                  <span className="inv-mono shrink-0 text-[10px] font-bold uppercase">
                    Notify
                  </span>
                </div>

                <div className="inv-verdict-caution flex items-start justify-between gap-2 p-2.5">
                  <div>
                    <p className="font-semibold">! Unverified · proceed with caution</p>
                    <p className="mt-0.5 opacity-85">
                      Shortened URL or missing date signals. Shown with caution banner; external push held.
                    </p>
                  </div>
                  <span className="inv-mono shrink-0 text-[10px] font-bold uppercase">
                    In-app
                  </span>
                </div>

                <div className="inv-verdict-rejected flex items-start justify-between gap-2 p-2.5">
                  <div>
                    <p className="font-semibold">✕ Blocked</p>
                    <p className="mt-0.5 opacity-85">
                      Scam language, phishing domain, or policy violation. Never reaches communities.
                    </p>
                  </div>
                  <span className="inv-mono shrink-0 text-[10px] font-bold uppercase">
                    Dropped
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Topic Communities Strip */}
          {topicGroups.length > 0 && (
            <div className="mt-7 border-t border-[var(--inv-border)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inv-kicker">Curated Topic Communities</span>
                <Link href="/groups" className="text-xs font-semibold hover:underline inv-text-secondary">
                  Browse all groups &amp; private circles →
                </Link>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Link href="/groups/general" className="inv-chip-accent px-3 py-1 text-xs font-semibold">
                  #Everyone
                </Link>
                {topicGroups.map((g) => (
                  <Link
                    key={g.id}
                    href={`/groups/${g.slug}`}
                    className="inv-chip px-3 py-1 text-xs font-medium"
                  >
                    #{g.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Feed Header & Segmented Filter Bar */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">
            {user ? "Personalised Dispatch" : "Live Public Dispatch"}
          </span>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-3">
            <h2 className="inv-heading text-2xl font-bold sm:text-3xl">
              {user ? "Your feed" : "Happening now on Invitz"}
            </h2>
            {feed.length > 0 && (
              <span className="inv-mono text-xs inv-text-muted">
                {feed.length} {feed.length === 1 ? "invite" : "invites"} · {verifiedCount} verified
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user && (
            <div
              role="tablist"
              aria-label="Feed filter"
              className="inv-surface-subtle flex gap-1 p-1 text-xs sm:text-sm"
            >
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <Link
                    key={t.key}
                    href={t.key === "all" ? "/" : `/?tab=${t.key}`}
                    role="tab"
                    aria-selected={active}
                    className={`px-3.5 py-1.5 transition ${
                      active
                        ? "inv-card font-semibold shadow-2xs"
                        : "inv-text-secondary hover:text-[var(--inv-ink)]"
                    }`}
                    style={{ borderRadius: "var(--inv-radius-btn)" }}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Signed-in Quick Communities Bar */}
      {user && topicGroups.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="inv-kicker mr-1 shrink-0">Communities:</span>
          <Link href="/groups/general" className="inv-chip shrink-0 px-2.5 py-1 text-xs font-medium">
            #Everyone
          </Link>
          {topicGroups.slice(0, 7).map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.slug}`}
              className="inv-chip shrink-0 px-2.5 py-1 text-xs"
            >
              #{g.name}
            </Link>
          ))}
          <Link href="/groups" className="inv-chip shrink-0 px-2.5 py-1 text-xs font-semibold">
            All →
          </Link>
        </div>
      )}

      {/* Feed List or Empty State */}
      {feed.length === 0 ? (
        <EmptyState
          title={
            tab === "following"
              ? "Nobody you follow has shared yet"
              : tab === "mine"
                ? "No invites in your communities yet"
                : "No invites here yet"
          }
          hint={
            tab === "following"
              ? "Follow trusted curators from the People directory to see their invites here."
              : "Be the first to share a quality-checked event with the community."
          }
        >
          <div className="flex flex-wrap gap-2">
            <Link
              href={user ? "/share" : "/login"}
              className="inv-btn-primary px-4 py-2 text-sm"
            >
              Share an event
            </Link>
            {tab === "following" && (
              <Link href="/people" className="inv-btn-secondary px-4 py-2 text-sm">
                Discover curators
              </Link>
            )}
          </div>
        </EmptyState>
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
