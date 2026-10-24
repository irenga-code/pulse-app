import { useState } from 'react';
import { MapPin, Plus, Check, Bookmark } from 'lucide-react';
import { useVenueLibrary } from '@/context/VenueLibraryContext';
import VenueVibes from '@/components/reactions/VenueVibes';
import VenueLogo from '@/components/VenueLogo';
import VenueStatusBadge from '@/components/VenueStatusBadge';
import VenueSheet from '@/components/VenueSheet';
import type { Venue } from '@/lib/types';

type Props = {
  venue: Venue;
};

export default function VenueCard({ venue }: Props) {
  const { isSaved, toggleSaved, isFollowing, toggleFollow } = useVenueLibrary();
  const [open, setOpen] = useState(false);
  const saved = isSaved(venue.id);
  const following = isFollowing(venue.id);

  return (
    <div className="bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder transition-all duration-300 hover:shadow-lg animate-slide-up">
      {/* Image */}
      <div className="group relative h-40 overflow-hidden">
        {venue.image_url ? (
          <img
            src={venue.image_url}
            alt={venue.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-wa-darkSecondary flex items-center justify-center">
            <MapPin className="w-10 h-10 text-wa-quiet" />
          </div>
        )}
        {/* the whole cover opens the venue; the badge and bookmark sit above it */}
        <button onClick={() => setOpen(true)} aria-label={`Open ${venue.name}`} className="absolute inset-0" />
        {/* Status badge */}
        <VenueStatusBadge venue={venue} className="absolute top-3 left-3 pointer-events-none" />

        {/* Save / bookmark */}
        <button
          onClick={() => toggleSaved(venue.id)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${venue.name} from saved venues` : `Save ${venue.name}`}
          className="absolute top-3 right-3 p-2 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors"
        >
          <Bookmark className={`w-4 h-4 ${saved ? 'fill-wa-green text-wa-green' : ''}`} />
        </button>
      </div>

      {/* Info */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <button onClick={() => setOpen(true)} className="min-w-0 flex-1 flex items-start gap-2.5 text-left">
            {/* overlaps the cover's bottom-left corner; a club icon when there is no logo */}
            <VenueLogo venue={venue} size={52} fallback className="-mt-9 relative shadow-md" />
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
          </button>
          <button
            onClick={() => toggleFollow(venue.id)}
            aria-pressed={following}
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
        <VenueVibes venueId={venue.id} />
      </div>
      {open && <VenueSheet venue={venue} onClose={() => setOpen(false)} />}
    </div>
  );
}
