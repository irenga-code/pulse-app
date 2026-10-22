import { useState } from 'react';
import { Pencil, Store } from 'lucide-react';
import { Spinner, ErrorNote, inputClass, ghostBtn, mutedText, bodyText } from '@/components/ui';
import VenueProfileModal from '@/components/profile/VenueProfileModal';
import { panelCard } from '@/admin/shared';
import { VenueStatusButtons, DurationSelect } from '@/components/VenueStatusControls';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { isVenueLive, statusLabel, timeLeft } from '@/lib/venues';
import { useVenues } from '@/hooks/useVenues';
import { useToast } from '@/context/ToastContext';
import type { Venue, VenueStatus } from '@/lib/types';

/** Admins set any venue's status (same set_venue_status RPC venue managers use; the database checks is_admin()). */
export default function VenuesPanel() {
  const { show } = useToast();
  const { venues, loading, error, reload } = useVenues({ orderBy: 'name' });
  const [minutes, setMinutes] = useState(360);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Venue | null>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? venues.filter((v) => `${v.name} ${v.location}`.toLowerCase().includes(q)) : venues;
  const liveCount = venues.filter(isVenueLive).length;

  const set = async (venue: Venue, status: VenueStatus) => {
    setBusy(`${venue.id}:${status}`);
    setSaveError(null);
    try {
      await api.setVenueStatus(venue.id, status, minutes);
      show(`${venue.name} is now ${statusLabel(status)}`);
      reload();
    } catch (e) {
      setSaveError(`${venue.name}: ${friendlyError(e)}`);
    }
    setBusy(null);
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search venues" aria-label="Search venues" className={`${inputClass} flex-1 min-w-[10rem]`} />
        <label className="flex items-center gap-2 text-xs">
          <span className={mutedText}>Keep Live / Sold out for</span>
          <DurationSelect value={minutes} onChange={setMinutes} />
        </label>
      </div>
      <p className={`text-xs ${mutedText}`}>{venues.length} venues · {liveCount} live now. Changes show in the app right away.</p>
      {saveError && <ErrorNote message={saveError} />}
      {shown.length === 0 ? (
        <div className={`${panelCard} text-center py-10`}>
          <Store className="w-10 h-10 text-wa-quiet mx-auto mb-2" />
          <p className={`text-sm ${mutedText}`}>{q ? 'No venue matches.' : 'No venues yet.'}</p>
        </div>
      ) : (
        shown.map((v) => {
          const live = isVenueLive(v);
          const left = v.status !== 'not_active' ? timeLeft(v.status_expires_at) : null;
          return (
            <div key={v.id} className={panelCard}>
              <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                <h3 className={`font-semibold text-sm ${bodyText}`}>{v.name}</h3>
                <span className={`text-xs ${mutedText}`}>{v.location}</span>
                {live && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5 bg-wa-live text-white">
                    LIVE{v.status !== 'live' && ' · event'}
                  </span>
                )}
                {left && <span className="text-[11px] text-wa-green ml-auto">{left}</span>}
                <button onClick={() => setEditing(v)} className={`${ghostBtn} !px-3 !py-1.5 text-xs ${left ? '' : 'ml-auto'}`}>
                  <Pencil className="w-3.5 h-3.5" />
                  Edit venue
                </button>
              </div>
              <VenueStatusButtons venue={v} busy={busy} onSet={set} />
            </div>
          );
        })
      )}
      {editing && <VenueProfileModal venue={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
