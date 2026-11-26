import { and, desc, eq, ilike, isNull, ne } from "drizzle-orm";
import Link from "next/link";
import {
  discardNotificationDelivery,
  markAllRead,
  markOneRead,
  retryNotificationDelivery,
} from "@/app/actions/social";
import { EmptyState } from "@/components/invite-card";
import { VerdictBadge } from "@/components/verdict";
import { db } from "@/db";
import { events, invites, notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

type FilterKey = "all" | "unread" | "people" | "communities";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "people", label: "From people" },
  { key: "communities", label: "From communities" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { filter: rawFilter } = await searchParams;
  const activeFilter: FilterKey =
    rawFilter === "unread" || rawFilter === "people" || rawFilter === "communities" ? rawFilter : "all";

  const base = db
    .select({
      id: notifications.id,
      reason: notifications.reason,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      status: notifications.status,
      deliveryStatus: notifications.deliveryStatus,
      attempts: notifications.attempts,
      scheduledFor: notifications.scheduledFor,
      channel: notifications.channel,
      error: notifications.error,
      inviteId: invites.id,
      verdict: invites.verdict,
      confidence: invites.confidence,
      title: events.title,
    })
    .from(notifications)
    .innerJoin(invites, eq(invites.id, notifications.inviteId))
    .innerJoin(events, eq(events.id, invites.eventId));

  const inAppConditions = [eq(notifications.userId, user.id), eq(notifications.channel, "in_app")];
  if (activeFilter === "unread") {
    inAppConditions.push(isNull(notifications.readAt));
  } else if (activeFilter === "people") {
    inAppConditions.push(ilike(notifications.reason, "%You follow %"));
  } else if (activeFilter === "communities") {
    inAppConditions.push(ilike(notifications.reason, "%Shared in %"));
  }

  const [inApp, external] = await Promise.all([
    base
      .where(and(...inAppConditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
    base
      .where(and(eq(notifications.userId, user.id), ne(notifications.channel, "in_app")))
      .orderBy(desc(notifications.createdAt))
      .limit(20),
  ]);

  const unreadItems = inApp.filter((n) => !n.readAt).length;
  const dlqCount = external.filter((n) => n.status === "dead_letter" || n.status === "failed").length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--inv-border)] pb-4">
        <div>
          <span className="inv-kicker">Alert Inbox &amp; Delivery Log</span>
          <h1 className="inv-heading mt-0.5 text-3xl font-bold">Notifications</h1>
          <p className="inv-text-secondary mt-1 text-sm">
            In-app dispatches, scheduled digests, and verified external channel pushes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/settings" className="inv-btn-secondary px-3.5 py-1.5 text-xs">
            Configure channels
          </Link>
          {inApp.length > 0 && (
            <form action={markAllRead}>
              <button type="submit" className="inv-btn-primary px-4 py-1.5 text-xs">
                Mark all read {unreadItems > 0 ? `(${unreadItems})` : ""}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <nav aria-label="Notification filters" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = activeFilter === f.key;
          const href = f.key === "all" ? "/notifications" : `/notifications?filter=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`${
                active ? "inv-chip-accent font-semibold" : "inv-chip"
              } px-3.5 py-1.5 text-xs`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {inApp.length === 0 ? (
        <EmptyState
          title={activeFilter === "all" ? "You're all caught up" : "No notifications in this filter"}
          hint={
            activeFilter === "all"
              ? "Join communities or follow curators to get notified when new events pass quality control."
              : "Switch back to All notifications or follow more people and communities."
          }
        >
          <div className="flex flex-wrap gap-2">
            {activeFilter !== "all" ? (
              <Link href="/notifications" className="inv-btn-primary px-4 py-2 text-sm">
                View all notifications
              </Link>
            ) : (
              <>
                <Link href="/groups" className="inv-btn-primary px-4 py-2 text-sm">
                  Browse communities
                </Link>
                <Link href="/people" className="inv-btn-secondary px-4 py-2 text-sm">
                  Find curators
                </Link>
              </>
            )}
          </div>
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {inApp.map((n) => {
            const isUnread = !n.readAt;
            return (
              <li
                key={n.id}
                className={`inv-card inv-card-interactive flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 ${
                  isUnread ? "border-[var(--inv-accent)]" : ""
                }`}
              >
                <Link href={`/invites/${n.inviteId}`} className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      isUnread ? "bg-[var(--inv-accent)]" : "bg-[var(--inv-border-strong)]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-[var(--inv-ink)]">{n.title}</p>
                    <p className="inv-text-muted mt-0.5 text-xs sm:text-sm">
                      {n.reason} · <span className="inv-mono">{timeAgo(n.createdAt)}</span>
                    </p>
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {isUnread && (
                    <form action={markOneRead}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button type="submit" className="inv-btn-secondary px-2.5 py-1 text-[11px]">
                        Mark read
                      </button>
                    </form>
                  )}
                  <VerdictBadge verdict={n.verdict} confidence={n.confidence} compact />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {external.length > 0 && (
        <section className="inv-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--inv-border)] pb-3">
            <div>
              <span className="inv-kicker">External Pushes &amp; Queue</span>
              <h2 className="inv-heading text-lg font-bold">
                Delivery log{" "}
                {dlqCount > 0 && (
                  <span className="inv-verdict-rejected ml-1 px-2 py-0.5 text-xs font-semibold">
                    {dlqCount} failed / dead-letter
                  </span>
                )}
              </h2>
            </div>
            <span className="inv-mono text-xs inv-text-muted">Discord · Telegram · WhatsApp · Signal · E-mail</span>
          </div>
          <ul className="mt-3 divide-y divide-[var(--inv-border)] text-sm">
            {external.map((n) => {
              const isRetryable = n.status === "failed" || n.status === "dead_letter";
              const statusCls = isRetryable
                ? "inv-verdict-rejected"
                : n.status === "dry_run" || n.status === "queued" || n.status === "pending"
                  ? "inv-verdict-caution"
                  : n.status === "skipped"
                    ? "inv-chip"
                    : "inv-verdict-verified";
              return (
                <li key={n.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/invites/${n.inviteId}`} className="block truncate font-medium hover:underline">
                      {n.title}
                    </Link>
                    <p className="inv-mono mt-0.5 text-xs inv-text-muted">
                      {n.attempts > 0 ? `Attempt ${n.attempts}/5` : "Scheduled"}
                      {n.deliveryStatus ? ` · ${n.deliveryStatus}` : ""}
                      {n.scheduledFor && (n.status === "queued" || n.status === "pending")
                        ? ` · scheduled ${n.scheduledFor.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                      {n.error ? ` · ${n.error}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="inv-mono inv-chip px-2.5 py-0.5 text-xs uppercase">{n.channel}</span>
                    <span className={`inv-mono px-2.5 py-0.5 text-xs font-semibold ${statusCls}`}>
                      {n.status}
                    </span>
                    {isRetryable && (
                      <>
                        <form action={retryNotificationDelivery}>
                          <input type="hidden" name="notificationId" value={n.id} />
                          <button type="submit" className="inv-btn-primary px-2.5 py-1 text-xs">
                            Retry
                          </button>
                        </form>
                        <form action={discardNotificationDelivery}>
                          <input type="hidden" name="notificationId" value={n.id} />
                          <button type="submit" className="inv-btn-secondary px-2.5 py-1 text-xs">
                            Discard
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
