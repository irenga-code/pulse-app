import type { Venue } from '@/lib/types';

/** A venue's round logo (migration 11). Renders nothing when the venue has none. */
export default function VenueLogo({ venue, size = 40, className = '' }: { venue: Pick<Venue, 'name' | 'logo_url'>; size?: number; className?: string }) {
  if (!venue.logo_url) return null;
  return (
    <img
      src={venue.logo_url}
      alt={`${venue.name} logo`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover flex-shrink-0 bg-wa-lightPanel dark:bg-wa-darkPanel border-2 border-wa-lightPanel dark:border-wa-darkSecondary ${className}`}
      loading="lazy"
    />
  );
}
