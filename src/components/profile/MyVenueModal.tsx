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
import type { Venue, VenueStatus } from '@/lib/types';
import { VenueStatusButtons, DurationSelect } from '@/components/VenueStatusControls';
import { statusLabel, timeLeft } from '@/lib/venues';
import { userKey } from '@/lib/cache';

/** Venue accounts set their own venue's status. Live / Sold out expire automatically. */
export default function MyVenueModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const managed = useAsync(() => api.managedVenueIds(user!.id), [], user ? userKey(user.id, 'managed-venues') : null);
  const [minutes, setMinutes] = useState(360);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, Venue>>({});
  const [error, setError] = useState<string | null>(null);

  const mine = (managed.data ?? []).map((id) => fresh[id] ?? venues.find((v) => v.id === id)).filter((v): v is Venue => !!v);

  const set = async (venue: Venue, status: VenueStatus) => {
    setBusy(`${venue.id}:${status}`);
    setError(null);
    try {
      const updated = await api.setVenueStatus(venue.id, status, minutes);
      setFresh((f) => ({ ...f, [venue.id]: { ...venue, status: updated.status, status_expires_at: updated.status_expires_at } }));
      show(`${venue.name} is now ${statusLabel(status)}`);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(null);
  };

  return (
    <Modal title="My venue" icon={Store} onClose={onClose}>
      {managed.loading ? (
        <Spinner />
      ) : mine.length === 0 ? (
        <p className={`text-sm py-6 text-center ${mutedText}`}>You do not manage any venue yet.</p>
      ) : (
        <div className="space-y-5">
          <label className="flex items-center gap-2 text-xs">
            <span className={mutedText}>Keep Live / Sold out for</span>
            <DurationSelect value={minutes} onChange={setMinutes} />
          </label>
          {mine.map((v) => (
            <div key={v.id}>
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className={`font-semibold text-sm ${bodyText}`}>{v.name}</h3>
                <span className={`text-xs ${mutedText}`}>{v.location}</span>
                {timeLeft(v.status_expires_at) && v.status !== 'not_active' && (
                  <span className="text-[11px] text-wa-green ml-auto">{timeLeft(v.status_expires_at)}</span>
                )}
              </div>
              <VenueStatusButtons venue={v} busy={busy} onSet={set} />
            </div>
          ))}
          {error && <ErrorNote message={error} />}
          <p className={`text-[11px] leading-relaxed ${mutedText}`}>
            Followers get an alert when you go live. Posts you make tagged with your venue show the Official badge once your venue is verified.
          </p>
        </div>
      )}
    </Modal>
  );
}
