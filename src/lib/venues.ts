import type { Venue, VenueStatus } from './types';

/**
 * Whether a venue shows as LIVE. The database decides (`venues_public.is_live`: status Live and not expired,
 * or a published event running now, never when Sold out); before that column exists, the status alone.
 */
export const isVenueLive = (v: Pick<Venue, 'status' | 'is_live'>) => v.is_live ?? v.status === 'live';

/** Status choices for set_venue_status (venue managers and admins). */
export const statusOptions: { status: VenueStatus; label: string; style: string }[] = [
  { status: 'live', label: 'Live now', style: 'border-wa-live text-wa-live bg-wa-live/10' },
  { status: 'sold_out', label: 'Sold out', style: 'border-wa-busy text-wa-busy bg-wa-busy/10' },
  { status: 'not_active', label: 'Not active', style: 'border-wa-quiet text-wa-quiet bg-wa-quiet/10' },
];
export const statusDurations = [{ m: 60, l: '1 hour' }, { m: 180, l: '3 hours' }, { m: 360, l: '6 hours' }, { m: 720, l: '12 hours' }];

export const statusLabel = (s: VenueStatus) => statusOptions.find((o) => o.status === s)?.label ?? 'Not active';

export function timeLeft(iso?: string | null) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return null;
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
}
