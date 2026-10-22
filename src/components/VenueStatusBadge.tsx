import type { Venue } from '@/lib/types';
import { isVenueLive } from '@/lib/venues';

type StatusConfig = {
  label: string;
  color: string;
  dot: string;
  bg: string;
};

const statusConfigs: Record<string, StatusConfig> = {
  live: {
    label: 'Live now',
    color: 'text-wa-live',
    dot: 'bg-wa-live',
    bg: 'bg-wa-live/10',
  },
  sold_out: {
    label: 'Sold out',
    color: 'text-wa-busy',
    dot: 'bg-wa-busy',
    bg: 'bg-wa-busy/10',
  },
  not_active: {
    label: 'Not active',
    color: 'text-wa-quiet',
    dot: 'bg-wa-quiet',
    bg: 'bg-wa-quiet/10',
  },
};

/** Live / Sold out / Not active pill, shared by the venue card and the venue sheet. */
export default function VenueStatusBadge({ venue, className = '' }: { venue: Venue; className?: string }) {
  const isLive = isVenueLive(venue);
  // an event running now makes the venue live even if its own status was never switched on
  const status = isLive ? statusConfigs.live : statusConfigs[venue.status] ?? statusConfigs.not_active;

  return (
    <div className={`flex items-center gap-1.5 ${status.bg} backdrop-blur-sm rounded-full px-2.5 py-1 ${className}`}>
      {isLive ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-wa-live animate-pulse-dot" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-wa-live" />
        </span>
      ) : (
        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
      )}
      <span className={`text-xs font-semibold ${status.color}`}>{status.label}</span>
    </div>
  );
}
