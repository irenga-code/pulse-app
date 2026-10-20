import { Loader2 } from 'lucide-react';
import { bodyText } from '@/components/ui';
import { statusDurations, statusOptions } from '@/lib/venues';
import type { Venue, VenueStatus } from '@/lib/types';

export function DurationSelect({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-lg px-2 py-1 text-xs bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightText dark:text-wa-darkText">
      {statusDurations.map((d) => <option key={d.m} value={d.m}>{d.l}</option>)}
    </select>
  );
}

/** Status controls shared by venue managers (My venue) and admins (Moderation > Venues): both call set_venue_status. */

/** Live now / Sold out / Not active buttons for one venue. `busy` is "<venue id>:<status>" while a change is saving. */
export function VenueStatusButtons({ venue, busy, onSet }: { venue: Venue; busy: string | null; onSet: (venue: Venue, status: VenueStatus) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Status of ${venue.name}`}>
      {statusOptions.map((o) => (
        <button
          key={o.status}
          onClick={() => onSet(venue, o.status)}
          disabled={busy !== null}
          aria-pressed={venue.status === o.status}
          className={`rounded-xl py-2.5 text-xs font-semibold border transition-colors disabled:opacity-60 ${
            venue.status === o.status ? o.style : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText}`
          }`}
        >
          {busy === `${venue.id}:${o.status}` ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : o.label}
        </button>
      ))}
    </div>
  );
}
