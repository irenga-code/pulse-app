import { useState } from 'react';
import { AlertCircle, Flame, MapPin } from 'lucide-react';
import { useVenues } from '@/hooks/useVenues';
import { isVenueLive } from '@/lib/venues';
import { VenueGridSkeleton } from '@/components/Skeleton';
import VenueLogo from '@/components/VenueLogo';
import VenueSheet from '@/components/VenueSheet';

export default function TonightTab() {
  // all venues, filtered here: a venue is also live while one of its events is running, not only by status
  const { venues: all, loading, error } = useVenues({ orderBy: 'name' });
  const venues = all.filter(isVenueLive);
  // by id, so the open sheet follows realtime updates
  const [openId, setOpenId] = useState<string | null>(null);
  const open = all.find((v) => v.id === openId);

  return (
    <div className="flex flex-col h-full bg-wa-light dark:bg-wa-dark">
      <div className="px-4 md:px-8 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 text-wa-live" />
          <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Tonight</h1>
        </div>
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-0.5">
          What's happening right now in Kampala
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-6">
        {loading ? (
          <VenueGridSkeleton count={3} tall label="Loading tonight's lineup" />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="w-10 h-10 text-wa-live" />
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3 text-center">
              Something went wrong. Please try again.
            </p>
          </div>
        ) : venues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary text-center">
              No venues are live right now. Check back later!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mt-2">
            {venues.map((venue) => (
              <button
                type="button"
                key={venue.id}
                onClick={() => setOpenId(venue.id)}
                aria-label={`Open ${venue.name}`}
                className="block w-full text-left relative rounded-2xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder animate-slide-up"
              >
                <div className="relative h-52 md:h-56 lg:h-64">
                  {venue.image_url && (
                    <img
                      src={venue.image_url}
                      alt={venue.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  {/* Live badge */}
                  {isVenueLive(venue) && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-wa-live rounded-full px-3 py-1">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-white animate-pulse-dot" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                      </span>
                      <span className="text-xs font-bold text-white">LIVE</span>
                    </div>
                  )}
                  {/* Info overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 flex items-center gap-3">
                    <VenueLogo venue={venue} size={48} className="shadow-md" />
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-white truncate">{venue.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-xs text-white/80">
                          <MapPin className="w-3 h-3" />
                          {venue.location}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {open && <VenueSheet venue={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
