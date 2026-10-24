import { Store } from 'lucide-react';
import type { Venue } from '@/lib/types';

type Props = {
  venue: Pick<Venue, 'name' | 'logo_url'>;
  size?: number;
  className?: string;
  /** Show a club icon when the venue has no logo (otherwise nothing renders). */
  fallback?: boolean;
};

/** A venue's round logo (migration 11). Renders nothing when the venue has none, unless `fallback` is set. */
export default function VenueLogo({ venue, size = 40, className = '', fallback = false }: Props) {
  const ring = `rounded-full flex-shrink-0 bg-wa-lightPanel dark:bg-wa-darkPanel border-2 border-wa-lightPanel dark:border-wa-darkSecondary ${className}`;
  if (!venue.logo_url) {
    if (!fallback) return null;
    return (
      <span role="img" aria-label={`${venue.name} logo`} style={{ width: size, height: size }} className={`${ring} inline-flex items-center justify-center`}>
        <Store className="text-wa-green" style={{ width: size * 0.45, height: size * 0.45 }} />
      </span>
    );
  }
  return (
    <img
      src={venue.logo_url}
      alt={`${venue.name} logo`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`object-cover ${ring}`}
      loading="lazy"
    />
  );
}
