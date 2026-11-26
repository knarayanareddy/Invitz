import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { users } from "@/db/schema";

type User = typeof users.$inferSelect;

export function Nav({ user, unread }: { user: User | null; unread: number }) {
  const link = "rounded-lg px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900";
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-1">
          <Link href="/" className="mr-2 flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm text-white" aria-hidden>
              ✉
            </span>
            invitz
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Main navigation">
            <Link href="/" className={link}>Feed</Link>
            <Link href="/groups" className={link}>Groups</Link>
            <Link href="/people" className={link}>People</Link>
            <Link href="/guidelines" className={`${link} hidden md:inline-block`}>How QC works</Link>
          </nav>
        </div>
        {user ? (
          <div className="flex items-center gap-1">
            <Link href="/share" className="mr-1 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
              + Share
            </Link>
            <Link href="/notifications" className={`${link} relative`} aria-label="Notifications">
              <span aria-hidden>🔔</span>
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <Link href="/settings" className={`${link} max-w-32 truncate`}>@{user.handle}</Link>
            <form action={logout}>
              <button className={link}>Sign out</button>
            </form>
          </div>
        ) : (
          <Link href="/login" className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
