import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { users } from "@/db/schema";

type User = typeof users.$inferSelect;

export function Nav({ user, unread }: { user: User | null; unread: number }) {
  const linkCls = "inv-nav-link px-3 py-1.5 text-sm";

  return (
    <header className="inv-header sticky top-0 z-30">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/"
            className="mr-2 flex items-center gap-2.5 text-lg font-bold tracking-tight text-[var(--inv-ink)]"
          >
            <span
              className="inv-btn-primary grid h-7 w-7 place-items-center text-xs font-bold shadow-xs"
              aria-hidden
            >
              ✦
            </span>
            <span className="inv-heading text-xl tracking-tight">invitz</span>
          </Link>

          <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main navigation">
            <Link href="/" className={linkCls}>
              Feed
            </Link>
            <Link href="/groups" className={linkCls}>
              Groups
            </Link>
            <Link href="/people" className={linkCls}>
              People
            </Link>
            <Link href="/guidelines" className={`${linkCls} hidden md:inline-block`}>
              How QC works
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {user ? (
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Link
                href="/share"
                className="inv-btn-primary px-3.5 py-1.5 text-xs sm:px-4 sm:text-sm"
              >
                <span aria-hidden>+</span> Share
              </Link>
              <Link
                href="/notifications"
                className={`${linkCls} relative inline-flex items-center justify-center`}
                aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zM8.05 14.943a33.54 33.54 0 003.9 0 2 2 0 01-3.9 0z"
                    clipRule="evenodd"
                  />
                </svg>
                {unread > 0 && (
                  <span className="inv-mono absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--inv-blocked-bar)] px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <Link
                href="/settings"
                className={`${linkCls} inv-mono max-w-28 truncate text-xs sm:text-sm`}
                title={`Account settings (@${user.handle})`}
              >
                @{user.handle}
              </Link>
              <form action={logout}>
                <button type="submit" className={`${linkCls} text-xs sm:text-sm`}>
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Link
                href="/login"
                className="inv-btn-primary px-4 py-1.5 text-xs sm:text-sm"
              >
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
