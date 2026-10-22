import { useState } from 'react';
import { Store } from 'lucide-react';
import Modal from '@/components/Modal';
import { Spinner, ErrorNote, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Venue, VenueRole, VenueStatus } from '@/lib/types';
import { VenueStatusButtons, DurationSelect } from '@/components/VenueStatusControls';
import VenueProfileForm from '@/components/profile/VenueProfileForm';
import VenuePostComposer from '@/components/profile/VenuePostComposer';
import { statusLabel, timeLeft } from '@/lib/venues';
import { userKey } from '@/lib/cache';

const roleLabel: Record<VenueRole, string> = { owner: 'Owner', manager: 'Manager', host: 'Host' };
const section = 'pt-4 border-t border-wa-lightBorder dark:border-wa-darkBorder';
const heading = `text-xs font-semibold uppercase tracking-wide mb-2 ${mutedText}`;

/**
 * Hosts and venue managers run every venue they are linked to (venue_managers): pick one, then set its status,
 * post as it, or edit its profile. Live / Sold out expire automatically.
 */
export default function MyVenueModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const managed = useAsync(() => api.managedVenues(user!.id), [], user ? userKey(user.id, 'managed-venue-roles') : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(360);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, Venue>>({});
  const [error, setError] = useState<string | null>(null);

  const mine = (managed.data ?? [])
    .map((m) => ({ role: m.role, venue: fresh[m.venue_id] ?? venues.find((v) => v.id === m.venue_id) }))
    .filter((m): m is { role: VenueRole; venue: Venue } => !!m.venue);
  const current = mine.find((m) => m.venue.id === selectedId) ?? mine[0];

  const patchVenue = (venue: Venue, patch: Partial<Venue>) => setFresh((f) => ({ ...f, [venue.id]: { ...venue, ...patch } }));

  const set = async (venue: Venue, status: VenueStatus) => {
    setBusy(`${venue.id}:${status}`);
    setError(null);
    try {
      const updated = await api.setVenueStatus(venue.id, status, minutes);
      patchVenue(venue, { status: updated.status, status_expires_at: updated.status_expires_at });
      show(`${venue.name} is now ${statusLabel(status)}`);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(null);
  };

  return (
    <Modal title={mine.length > 1 ? 'My venues' : 'My venue'} icon={Store} onClose={onClose}>
      {managed.loading && !managed.data ? (
        <Spinner />
      ) : !current ? (
        <p className={`text-sm py-6 text-center ${mutedText}`}>You do not manage any venue yet.</p>
      ) : (
        <div className="space-y-4">
          {mine.length > 1 && (
            <div className="flex gap-2 overflow-x-auto whitespace-nowrap touch-pan-x -mx-1 px-1 pb-1" role="tablist" aria-label="Choose a venue">
              {mine.map(({ venue, role }) => {
                const active = venue.id === current.venue.id;
                return (
                  <button
                    key={venue.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setSelectedId(venue.id); setError(null); }}
                    className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${
                      active ? 'bg-wa-green text-white border-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText} hover:border-wa-green`
                    }`}
                  >
                    {venue.name}
                    <span className={`ml-1.5 font-normal ${active ? 'text-white/80' : mutedText}`}>{roleLabel[role]}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className={`font-semibold text-sm ${bodyText}`}>{current.venue.name}</h3>
              <span className={`text-xs ${mutedText}`}>{current.venue.location}</span>
              {mine.length === 1 && <span className={`text-xs ${mutedText}`}>· {roleLabel[current.role]}</span>}
              {timeLeft(current.venue.status_expires_at) && current.venue.status !== 'not_active' && (
                <span className="text-[11px] text-wa-green ml-auto">{timeLeft(current.venue.status_expires_at)}</span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs mb-2">
              <span className={mutedText}>Keep Live / Sold out for</span>
              <DurationSelect value={minutes} onChange={setMinutes} />
            </label>
            <VenueStatusButtons venue={current.venue} busy={busy} onSet={set} />
            {error && <div className="mt-2"><ErrorNote message={error} /></div>}
          </div>

          <div className={section}>
            <h4 className={heading}>Post as {current.venue.name}</h4>
            <VenuePostComposer key={current.venue.id} venue={current.venue} />
          </div>

          <div className={section}>
            <h4 className={heading}>Venue profile</h4>
            <VenueProfileForm key={current.venue.id} venue={current.venue} onSaved={(patch) => patchVenue(current.venue, patch)} />
          </div>

          <p className={`text-[11px] leading-relaxed ${mutedText}`}>
            Followers get an alert when you go live. Posts made as a verified venue show the Official badge.
          </p>
        </div>
      )}
    </Modal>
  );
}
