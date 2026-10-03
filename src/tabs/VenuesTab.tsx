import { useState } from 'react';
import { Loader2, AlertCircle, Flame, Ticket, Moon } from 'lucide-react';
import { useVenues } from '@/hooks/useVenues';
import VenueCard from '@/components/VenueCard';

type FilterId = 'all' | 'live' | 'sold_out' | 'not_active';

const filters: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live now' },
  { id: 'sold_out', label: 'Sold Out' },
  { id: 'not_active', label: 'Not Active' },
];

export default function VenuesTab() {
  const { venues, loading, error } = useVenues({ orderBy: 'created_at' });
  const [filter, setFilter] = useState<FilterId>('all');

  const filtered = filter === 'all'
    ? venues
    : venues.filter((v) => v.status === filter);

  const liveCount = venues.filter((v) => v.status === 'live').length;

  return (
    <div className="flex flex-col h-full">
      {/* Hero summary */}
      <div className="px-4 md:px-8 pt-4 pb-3 bg-wa-light dark:bg-wa-dark">
        <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Venues</h1>
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-0.5">
          {venues.length} venues in Kampala
          {liveCount > 0 && (
            <span className="text-wa-live font-medium"> · {liveCount} live now</span>
          )}
        </p>
      </div>

      {/* Filter pills */}
      <div className="sticky top-0 z-10 flex gap-2 px-4 md:px-8 py-2 bg-wa-light dark:bg-wa-dark overflow-hidden scrollbar-hide">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 flex-shrink-0 ${
              filter === f.id
                ? 'bg-wa-green text-white'
                : 'bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
            }`}
          >
            {f.id === 'live' && <Flame className="w-3.5 h-3.5" />}
            {f.id === 'sold_out' && <Ticket className="w-3.5 h-3.5" />}
            {f.id === 'not_active' && <Moon className="w-3.5 h-3.5" />}
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-6 bg-wa-light dark:bg-wa-dark">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-wa-green animate-spin" />
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3">
              Loading venues...
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="w-10 h-10 text-wa-live" />
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3 text-center">
              Could not load venues. Please try again.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
              No venues match this filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mt-2">
            {filtered.map((venue) => (
              <VenueCard key={venue.id} venue={venue} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
