import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-stone-900">Not found</h1>
      <p className="mt-2 text-sm text-stone-600">
        That invite, group, or profile doesn’t exist or is only visible to members.
      </p>
      <div className="mt-5">
        <Link href="/" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
          Back to feed
        </Link>
      </div>
    </div>
  );
}
