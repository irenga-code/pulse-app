import { useState } from 'react';
import { Bookmark, MapPin } from 'lucide-react';
import Modal from '@/components/Modal';
import VenueLogo from '@/components/VenueLogo';
import VenueSheet from '@/components/VenueSheet';
import { Spinner, ErrorNote, primaryBtn, mutedText } from '@/components/ui';
import { useVenues } from '@/hooks/useVenues';
import { useVenueLibrary } from '@/context/VenueLibraryContext';
import { useAuth } from '@/context/AuthContext';

const statusStyle: Record<string, string> = {
  live: 'text-wa-live bg-wa-live/10',
  sold_out: 'text-wa-busy bg-wa-busy/10',
  not_active: 'text-wa-quiet bg-wa-quiet/10',
};
const statusLabel: Record<string, string> = { live: 'Live now', sold_out: 'Sold out', not_active: 'Not active' };

export default function SavedVenuesModal({ onClose }: { onClose: () => void }) {
  const { user, openAuth } = useAuth();
  const { saved, loading: savedLoading, error: savedError, toggleSaved } = useVenueLibrary();
  const { venues, loading: venuesLoading, error: venuesError } = useVenues({ orderBy: 'created_at' });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = venues.find((v) => v.id === openId);

  if (!user) {
    return (
      <Modal title="Saved venues" icon={Bookmark} onClose={onClose}>
        <div className="flex flex-col items-center py-8 text-center">
          <Bookmark className="w-10 h-10 text-wa-quiet mb-3" />
          <p className={`text-sm ${mutedText} max-w-xs`}>Sign in to keep your favourite venues in one place.</p>
          <button
            onClick={() => { onClose(); openAuth('signin', 'Sign in to see your saved venues.'); }}
            className={`${primaryBtn} mt-4`}
          >
            Sign in
          </button>
        </div>
      </Modal>
    );
  }

  // swap rather than stack, so Esc only closes the sheet and returns to the list
  if (open) return <VenueSheet venue={open} onClose={() => setOpenId(null)} />;

  const loading = savedLoading || venuesLoading;
  const error = savedError || venuesError;

  // saved is newest-first; drop ids whose venue no longer exists
  const byId = new Map(venues.map((v) => [v.id, v]));
  const items = saved.flatMap((s) => {
    const venue = byId.get(s.venue_id);
    return venue ? [venue] : [];
  });

  return (
    <Modal title="Saved venues" icon={Bookmark} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : error && items.length === 0 ? (
        <ErrorNote message="Could not load saved venues. Please try again." />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Bookmark className="w-10 h-10 text-wa-quiet mb-3" />
          <p className={`text-sm font-medium ${mutedText}`}>No saved venues yet</p>
          <p className={`text-xs mt-1 max-w-xs ${mutedText}`}>Tap the bookmark on any venue in the Venues tab to keep it here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((venue) => (
            <li
              key={venue.id}
              className="flex items-center gap-3 bg-wa-light dark:bg-wa-dark rounded-xl p-3 border border-wa-lightBorder dark:border-wa-darkBorder"
            >
              <button type="button" onClick={() => setOpenId(venue.id)} className="min-w-0 flex-1 flex items-center gap-3 text-left">
                {venue.logo_url ? (
                  <VenueLogo venue={venue} size={48} />
                ) : venue.image_url ? (
                  <img src={venue.image_url} alt={venue.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-wa-darkSecondary flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-wa-quiet" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm text-wa-lightText dark:text-wa-darkText truncate">{venue.name}</h3>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin className={`w-3 h-3 flex-shrink-0 ${mutedText}`} />
                    <span className={`text-xs truncate ${mutedText}`}>{venue.location}</span>
                  </div>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${statusStyle[venue.status] ?? statusStyle.not_active}`}>
                  {statusLabel[venue.status] ?? 'Not active'}
                </span>
              </button>
              <button
                onClick={() => toggleSaved(venue.id)}
                aria-label={`Remove ${venue.name} from saved venues`}
                className="p-1.5 rounded-full text-wa-green hover:bg-wa-green/10 transition-colors"
              >
                <Bookmark className="w-5 h-5 fill-current" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
