import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { getCurrentUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { unreadCount } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Invitz — Trusted event sharing for curated communities",
  description:
    "Share any event URL with the right communities. Every link passes deterministic safety rules and AI quality control before anyone is notified.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureBootstrap();
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(user.id) : 0;

  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <body className="inv-body min-h-screen antialiased pb-10">
        <Nav user={user} unread={unread} />
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-5xl border-t border-[var(--inv-border)] px-4 py-8 text-xs sm:px-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <p className="font-semibold text-[var(--inv-ink)]">
                Invitz · Platform-agnostic, trust-checked event curation
              </p>
              <p className="inv-text-muted">
                Automated QC verdicts can be wrong. Always double-check event details before sharing personal information.
              </p>
            </div>
            <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-4 font-medium inv-text-secondary">
              <Link href="/" className="hover:underline">
                Feed
              </Link>
              <Link href="/groups" className="hover:underline">
                Communities
              </Link>
              <Link href="/people" className="hover:underline">
                Curators
              </Link>
              <Link href="/guidelines" className="hover:underline">
                QC Rulebook
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
