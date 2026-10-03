import { useState } from 'react';
import { MapPin, Plus, Check } from 'lucide-react';
import type { Venue } from '@/lib/supabase';

type StatusConfig = {
  label: string;
  color: string;
  dot: string;
  bg: string;
};

const statusConfigs: Record<string, StatusConfig> = {
  live: {
    label: 'Live tonight',
    color: 'text-wa-live',
    dot: 'bg-wa-live',
    bg: 'bg-wa-live/10',
  },
  sold_out: {
    label: 'Sold Out',
    color: 'text-wa-soldout',
    dot: 'bg-wa-soldout',
    bg: 'bg-wa-soldout/10',
  },
  not_active: {
    label: 'Not Active',
    color: 'text-wa-quiet',
    dot: 'bg-wa-quiet',
    bg: 'bg-wa-quiet/10',
  },
};

type Props = {
  venue: Venue;
};

export default function VenueCard({ venue }: Props) {
  const [following, setFollowing] = useState(false);
  const status = statusConfigs[venue.status] ?? statusConfigs.not_active;
  const isLive = venue.status === 'live';

  return (
    <div className="bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl overflow-y-auto border border-wa-lightBorder dark:border-wa-darkBorder transition-all duration-300 hover:shadow-lg animate-slide-up">
      {/* Image */}
      <div className="relative h-40 overflow-y-auto">
        {venue.image_url ? (
          <img
            src={venue.image_url}
            alt={venue.name}
            className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-wa-darkSecondary flex items-center justify-center">
            <MapPin className="w-10 h-10 text-wa-quiet" />
          </div>
        )}
        {/* Status badge */}
        <div className={`absolute top-3 left-3 flex items-center gap-1.5 ${status.bg} backdrop-blur-sm rounded-full px-2.5 py-1`}>
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

      </div>

      {/* Info */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-wa-lightText dark:text-wa-darkText text-base truncate">
              {venue.name}
            </h3>
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3.5 h-3.5 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary flex-shrink-0" />
              <span className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary truncate">
                {venue.location}
              </span>
            </div>
          </div>
          <button
            onClick={() => setFollowing((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 flex-shrink-0 ${
              following
                ? 'bg-wa-green/15 text-wa-green'
                : 'bg-wa-green text-white hover:bg-wa-greenDark'
            }`}
          >
            {following ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Following
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Follow
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
