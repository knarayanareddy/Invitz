export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between border-b border-[var(--inv-border)] pb-4">
        <div className="space-y-2">
          <div className="inv-surface-subtle h-3 w-28 animate-pulse" />
          <div className="inv-surface-subtle h-8 w-56 animate-pulse" />
        </div>
        <div className="inv-surface-subtle h-9 w-36 animate-pulse" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="inv-card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="inv-surface-subtle h-10 w-10 animate-pulse rounded-full" />
              <div className="space-y-1.5">
                <div className="inv-surface-subtle h-4 w-32 animate-pulse" />
                <div className="inv-surface-subtle h-3 w-20 animate-pulse" />
              </div>
            </div>
            <div className="inv-surface-subtle h-6 w-24 animate-pulse rounded-full" />
          </div>
          <div className="space-y-2">
            <div className="inv-surface-subtle h-6 w-3/4 animate-pulse" />
            <div className="inv-surface-subtle h-4 w-1/2 animate-pulse" />
            <div className="inv-surface-subtle h-12 w-full animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
