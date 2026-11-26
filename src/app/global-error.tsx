"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-stone-50 p-4 text-stone-900 antialiased">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Service unavailable</h1>
          <p className="mt-2 text-sm text-stone-600">
            Invitz could not connect to its backend right now. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
