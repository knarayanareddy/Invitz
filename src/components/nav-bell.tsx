"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function NavBell({ initialUnread, className }: { initialUnread: number; className: string }) {
  const [liveState, setLiveState] = useState<{ base: number; count: number } | null>(null);
  const unread = liveState && liveState.base === initialUnread ? liveState.count : initialUnread;

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/notifications/stream");
    const onBell = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { unreadCount?: number };
        if (typeof data.unreadCount === "number") {
          setLiveState({ base: initialUnread, count: data.unreadCount });
        }
      } catch {
        // Ignore malformed SSE event
      }
    };
    es.addEventListener("bell", onBell);
    return () => {
      es.removeEventListener("bell", onBell);
      es.close();
    };
  }, [initialUnread]);

  return (
    <Link
      href="/notifications"
      className={`${className} relative inline-flex items-center justify-center`}
      aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
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
  );
}
