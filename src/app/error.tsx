"use client";

import Link from "next/link";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="inv-card mx-auto max-w-md p-8 text-center">
      <div
        aria-hidden
        className="inv-verdict-rejected mx-auto mb-4 grid h-11 w-11 place-items-center text-base font-bold"
      >
        !
      </div>
      <span className="inv-kicker">Unexpected Application Error</span>
      <h1 className="inv-heading mt-1 text-2xl font-bold">Something went wrong</h1>
      <p className="inv-text-secondary mt-2 text-sm leading-relaxed">
        Invitz ran into an unexpected error. You can try loading this page again or return to the
        feed.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inv-btn-primary px-4 py-2 text-sm"
        >
          Try again
        </button>
        <Link href="/" className="inv-btn-secondary px-4 py-2 text-sm">
          Back to feed
        </Link>
      </div>
    </div>
  );
}
