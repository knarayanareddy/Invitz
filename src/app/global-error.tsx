"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <body className="inv-body grid min-h-screen place-items-center p-4 antialiased">
        <div className="inv-card w-full max-w-md p-8 text-center">
          <span className="inv-kicker">System Status</span>
          <h1 className="inv-heading mt-1 text-2xl font-bold">Service unavailable</h1>
          <p className="inv-text-secondary mt-2 text-sm leading-relaxed">
            Invitz could not connect to its backend right now. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inv-btn-primary mt-6 px-5 py-2.5 text-sm"
          >
            Retry connection
          </button>
        </div>
      </body>
    </html>
  );
}
