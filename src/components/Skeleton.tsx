/** Placeholder shapes shown only on a genuine first load (no cached data yet), instead of a centered spinner. */

const block = 'animate-pulse rounded-md bg-wa-lightBorder/80 dark:bg-wa-darkBorder/80';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`${block} ${className}`} />;
}

function Busy({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Avatar + two lines per row: lists in modals (notifications, saved items, requests, people). */
export function ListSkeleton({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <Busy label={label} className="space-y-3 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 !rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className={`h-3 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Venue cards in the same grid as the real ones. `tall` matches the Tonight cards. */
export function VenueGridSkeleton({ count = 6, tall = false, label = 'Loading venues' }: { count?: number; tall?: boolean; label?: string }) {
  return (
    <Busy label={label} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mt-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder">
          <Skeleton className={`${tall ? 'h-52 md:h-56 lg:h-64' : 'h-40'} !rounded-none`} />
          {!tall && (
            <div className="p-4 space-y-2.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          )}
        </div>
      ))}
    </Busy>
  );
}

/** Feed posts: author row, text lines, action row. */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Busy label="Loading posts" className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl p-4 bg-wa-lightPanel dark:bg-wa-darkSecondary border border-wa-lightBorder dark:border-wa-darkBorder">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 !rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2.5 w-1/5" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          {i === 0 && <Skeleton className="mt-3 h-40 w-full !rounded-xl" />}
          <div className="mt-3 flex gap-4">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
      ))}
    </Busy>
  );
}

/** Message bubbles, alternating sides. */
export function ChatSkeleton() {
  return (
    <Busy label="Loading messages" className="space-y-3 py-4">
      {['w-2/3', 'w-1/2 ml-auto', 'w-3/5', 'w-2/5 ml-auto'].map((w, i) => (
        <Skeleton key={i} className={`h-9 ${w} !rounded-2xl`} />
      ))}
    </Busy>
  );
}

/** A few short lines (comments under a post). */
export function LinesSkeleton({ lines = 2, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <Busy label={label} className="space-y-2 py-1.5">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-3 ${i % 2 ? 'w-1/2' : 'w-3/4'}`} />)}
    </Busy>
  );
}
