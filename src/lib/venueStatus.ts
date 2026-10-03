export type VenueStatus = 'live' | 'sold_out' | 'not_active';

export const VENUE_STATUSES: { id: VenueStatus; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'sold_out', label: 'Sold Out' },
  { id: 'not_active', label: 'Not Active' },
];

/** Lowercase display/search text, e.g. 'sold_out' -> 'sold out'. */
export function statusText(status: string): string {
  return status.replace(/_/g, ' ');
}
