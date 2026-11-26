"use client";

import Link from "next/link";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-stone-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-stone-600">
        Invitz ran into an unexpected error. You can try loading this page again or return to the feed.
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50">
          Back to feed
        </Link>
      </div>
    </div>
  );
}
