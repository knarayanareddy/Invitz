import Link from "next/link";
import type { ReactNode } from "react";
import { formatWhen, initials, timeAgo } from "@/lib/format";
import type { FeedInvite } from "@/lib/queries";
import { CautionBanner, VerdictBadge } from "./verdict";

export function Avatar({
  name,
  image,
  size = 36,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  let safeImage: string | null = null;
  if (image) {
    try {
      const parsed = new URL(image);
      if (parsed.protocol === "https:") {
        safeImage = parsed.href.replace(/["'()\\]/g, "");
      }
    } catch {
      safeImage = null;
    }
  }
  if (safeImage) {
    return (
      <span
        role="img"
        aria-label={name}
        className="block shrink-0 rounded-full border border-[var(--inv-border)] bg-[var(--inv-surface-subtle)] bg-cover bg-center"
        style={{ width: size, height: size, backgroundImage: `url("${safeImage}")` }}
      />
    );
  }
  return (
    <span
      className="inv-btn-primary grid shrink-0 place-items-center rounded-full font-bold tracking-tight"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function getDateParts(date: Date | string | null): { month: string; day: string; weekday: string } | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return {
    month: d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase(),
    day: d.toLocaleString("en", { day: "2-digit", timeZone: "UTC" }),
    weekday: d.toLocaleString("en", { weekday: "short", timeZone: "UTC" }),
  };
}

export function InviteCard({
  invite,
  detailed = false,
}: {
  invite: FeedInvite;
  detailed?: boolean;
}) {
  const when = formatWhen(invite.event.startsAt);
  const dateParts = getDateParts(invite.event.startsAt);

  return (
    <article className={`inv-card ${detailed ? "" : "inv-card-interactive"} p-5 sm:p-6`}>
      {/* Top Curator & Trust Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--inv-border)] pb-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={invite.sharer.displayName} size={38} />
          <div className="min-w-0 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link
                href={`/people/${invite.sharer.handle}`}
                className="font-semibold text-[var(--inv-ink)] hover:underline"
              >
                {invite.sharer.displayName}
              </Link>
              <span className="inv-mono text-xs inv-text-muted">@{invite.sharer.handle}</span>
              <span
                className="inv-chip inv-mono px-2 py-0.5 text-[10px]"
                title="Curator trust score"
              >
                trust {invite.sharer.trustScore}
              </span>
            </div>
            <p className="text-xs inv-text-muted">
              Shared {timeAgo(invite.createdAt)}
            </p>
          </div>
        </div>

        <VerdictBadge verdict={invite.verdict} confidence={invite.confidence} />
      </header>

      {/* Main Event Body with Calendar Date Stub */}
      <div className="mt-4 flex items-start gap-4">
        {dateParts && (
          <div
            aria-hidden
            className="inv-date-stub hidden w-14 shrink-0 flex-col items-center justify-center py-2 text-center sm:flex"
          >
            <span className="inv-mono text-[10px] font-bold tracking-wider uppercase text-[var(--inv-accent)]">
              {dateParts.month}
            </span>
            <span className="inv-heading mt-0.5 text-xl font-bold leading-none">
              {dateParts.day}
            </span>
            <span className="inv-mono mt-0.5 text-[10px] inv-text-muted">
              {dateParts.weekday}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="inv-heading text-xl font-bold leading-snug sm:text-2xl">
            {detailed ? (
              invite.event.title
            ) : (
              <Link href={`/invites/${invite.id}`} className="hover:underline">
                {invite.event.title}
              </Link>
            )}
          </h3>

          {/* Structured Event Metadata Pills */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm inv-text-secondary">
            {when && (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span aria-hidden className="opacity-75">📅</span>
                <span>{when}</span>
              </span>
            )}
            {invite.event.location && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="opacity-75">📍</span>
                <span>{invite.event.location}</span>
              </span>
            )}
            <span className="inv-chip inv-mono inline-flex items-center gap-1 px-2.5 py-0.5 text-xs">
              <span aria-hidden>↗</span>
              {invite.event.host}
            </span>
          </div>

          {invite.event.description && (
            <p
              className={`mt-2.5 text-sm leading-relaxed inv-text-secondary ${
                detailed ? "" : "line-clamp-2"
              }`}
            >
              {invite.event.description}
            </p>
          )}

          {invite.note && (
            <blockquote className="inv-note-quote mt-3.5 px-3.5 py-2.5 text-sm leading-relaxed">
              <span className="inv-kicker mr-2 not-italic">Curator note:</span>
              “{invite.note}”
            </blockquote>
          )}
        </div>
      </div>

      {invite.verdict === "caution" && (
        <div className="mt-4">
          <CautionBanner summary={invite.summary} />
        </div>
      )}

      {/* Footer: Target Communities + QC Audit + Primary Event Link */}
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--inv-border)] pt-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {invite.groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.slug}`}
              className="inv-chip px-2.5 py-1 text-xs font-medium"
            >
              #{g.name}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!detailed && (
            <Link
              href={`/invites/${invite.id}`}
              className="inv-btn-secondary px-3.5 py-1.5 text-xs"
            >
              QC report
            </Link>
          )}
          <a
            href={invite.event.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="inv-btn-ink px-4 py-1.5 text-xs sm:text-sm"
          >
            Open event <span aria-hidden>↗</span>
          </a>
        </div>
      </footer>
    </article>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="inv-empty p-10 text-center sm:p-12">
      <div
        aria-hidden
        className="inv-chip mx-auto mb-3 grid h-10 w-10 place-items-center text-base font-bold"
      >
        ✦
      </div>
      <p className="inv-heading text-lg font-bold">{title}</p>
      {hint && <p className="inv-text-muted mx-auto mt-1 max-w-md text-sm">{hint}</p>}
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </div>
  );
}
