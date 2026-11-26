import Link from "next/link";
import type { FeedInvite } from "@/lib/queries";
import { formatWhen, initials, timeAgo } from "@/lib/format";
import { CautionBanner, VerdictBadge } from "./verdict";

export function Avatar({ name, image, size = 36 }: { name: string; image?: string | null; size?: number }) {
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
        className="block shrink-0 rounded-full bg-stone-200 bg-cover bg-center"
        style={{ width: size, height: size, backgroundImage: `url("${safeImage}")` }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function InviteCard({ invite, detailed = false }: { invite: FeedInvite; detailed?: boolean }) {
  const when = formatWhen(invite.event.startsAt);
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <Avatar name={invite.sharer.displayName} />
        <div className="min-w-0 flex-1 text-sm">
          <Link href={`/people/${invite.sharer.handle}`} className="font-semibold text-stone-900 hover:underline">
            {invite.sharer.displayName}
          </Link>{" "}
          <span className="text-stone-500">@{invite.sharer.handle} · {timeAgo(invite.createdAt)}</span>
        </div>
        <VerdictBadge verdict={invite.verdict} confidence={invite.confidence} />
      </header>

      <div className="mt-4">
        <h3 className="text-lg font-semibold leading-snug text-stone-900">
          {detailed ? invite.event.title : <Link href={`/invites/${invite.id}`} className="hover:underline">{invite.event.title}</Link>}
        </h3>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-stone-500">
          {when && <span><span aria-hidden>📅</span> {when}</span>}
          {invite.event.location && <span><span aria-hidden>📍</span> {invite.event.location}</span>}
          <span><span aria-hidden>🔗</span> {invite.event.host}</span>
        </p>
        {invite.event.description && (
          <p className={`mt-2 text-sm text-stone-700 ${detailed ? "" : "line-clamp-2"}`}>{invite.event.description}</p>
        )}
        {invite.note && (
          <blockquote className="mt-3 border-l-2 border-violet-300 pl-3 text-sm italic text-stone-700">“{invite.note}”</blockquote>
        )}
      </div>

      {invite.verdict === "caution" && (
        <div className="mt-4">
          <CautionBanner summary={invite.summary} />
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {invite.groups.map((g) => (
          <Link
            key={g.id}
            href={`/groups/${g.slug}`}
            className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-violet-100 hover:text-violet-700"
          >
            #{g.name}
          </Link>
        ))}
        <a
          href={invite.event.url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="ml-auto rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
        >
          Open event ↗
        </a>
      </footer>
    </article>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 p-10 text-center">
      <p className="font-medium text-stone-800">{title}</p>
      {hint && <p className="mt-1 text-sm text-stone-500">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
