import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { getCurrentUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { unreadCount } from "@/lib/queries";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invitz — share events worth going to",
  description: "Share event links with the right communities. Every share is quality-checked, so your feed stays spam-free.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  await ensureBootstrap();
  const user = await getCurrentUser();
  const unread = user ? await unreadCount(user.id) : 0;
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <Nav user={user} unread={unread} />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-stone-500">
          Invitz · Automated QC verdicts can be wrong. Always double-check event details before sharing personal information.
        </footer>
      </body>
    </html>
  );
}
