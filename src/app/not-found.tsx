import Link from "next/link";

export default function NotFound() {
  return (
    <div className="inv-card mx-auto max-w-md p-8 text-center sm:p-10">
      <div
        aria-hidden
        className="inv-chip mx-auto mb-4 grid h-11 w-11 place-items-center text-sm font-bold inv-mono"
      >
        404
      </div>
      <span className="inv-kicker">Route or Resource Unavailable</span>
      <h1 className="inv-heading mt-1 text-2xl font-bold">Not found</h1>
      <p className="inv-text-secondary mt-2 text-sm leading-relaxed">
        That invite, group, or profile doesn’t exist or is only visible to members.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link href="/" className="inv-btn-primary px-4 py-2 text-sm">
          Back to feed
        </Link>
        <Link href="/groups" className="inv-btn-secondary px-4 py-2 text-sm">
          Browse groups
        </Link>
      </div>
    </div>
  );
}
