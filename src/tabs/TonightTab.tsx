import { Loader2, AlertCircle, Flame, MapPin } from 'lucide-react';
import { useVenues } from '@/hooks/useVenues';

export default function TonightTab() {
  const { venues, loading, error } = useVenues({ status: 'live', orderBy: 'name' });

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
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-wa-green animate-spin" />
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3">
              Loading tonight's lineup...
            </p>
          </div>
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
              <div
                key={venue.id}
                className="relative rounded-2xl overflow-y-auto border border-wa-lightBorder dark:border-wa-darkBorder animate-slide-up"
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
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-wa-live rounded-full px-3 py-1">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-white animate-pulse-dot" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                    </span>
                    <span className="text-xs font-bold text-white">LIVE</span>
                  </div>
                  {/* Info overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-lg font-bold text-white">{venue.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-white/80">
                        <MapPin className="w-3 h-3" />
                        {venue.location}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
