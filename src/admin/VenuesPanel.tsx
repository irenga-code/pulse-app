import { useState } from 'react';
import { BadgeCheck, Pencil, Store } from 'lucide-react';
import { Spinner, ErrorNote, inputClass, ghostBtn, mutedText, bodyText } from '@/components/ui';
import VenueProfileModal from '@/components/profile/VenueProfileModal';
import { Chip, FilterToggle, panelCard } from '@/admin/shared';
import { VenueStatusButtons, DurationSelect } from '@/components/VenueStatusControls';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { formatDateTime } from '@/lib/time';
import { isVenueLive, statusLabel, timeLeft } from '@/lib/venues';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { memUserKey } from '@/lib/cache';
import type { Venue, VenueStatus } from '@/lib/types';

/** Admins set any venue's status (same set_venue_status RPC venue managers use; the database checks is_admin()). */
export default function VenuesPanel() {
  const { show } = useToast();
  const { user } = useAuth();
  const { venues, loading, error, reload } = useVenues({ orderBy: 'name' });
  const [minutes, setMinutes] = useState(360);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'all' | 'registered'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Venue | null>(null);
  // who registered which venue (Register a club, migration 12)
  const registrations = useAsync(async () => {
    try {
      const rows = await api.adminRegisteredVenues();
      return { rows, people: await api.profilesByIds(rows.map((r) => r.created_by)) };
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  }, [], user ? memUserKey(user.id, 'admin-registered-venues') : null);
  const regById = new Map((registrations.data?.rows ?? []).map((r) => [r.id, r]));

  const q = query.trim().toLowerCase();
  const pool = view === 'registered'
    ? (registrations.data?.rows ?? []).flatMap((r) => venues.filter((v) => v.id === r.id))
    : venues;
  const shown = q ? pool.filter((v) => `${v.name} ${v.location}`.toLowerCase().includes(q)) : pool;
  const liveCount = venues.filter(isVenueLive).length;

  const verify = async (venue: Venue, verified: boolean) => {
    setBusy(`${venue.id}:verify`);
    setSaveError(null);
    try {
      await api.adminSetVenueVerified(venue.id, verified);
      show(verified ? `${venue.name} is verified` : `${venue.name} is no longer verified`);
      reload();
    } catch (e) {
      setSaveError(`${venue.name}: ${friendlyError(e)}`);
    }
    setBusy(null);
  };

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
      <FilterToggle
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'All venues' },
          { value: 'registered', label: `Registered by users${registrations.data ? ` (${registrations.data.rows.length})` : ''}` },
        ]}
      />
      <p className={`text-xs ${mutedText}`}>
        {view === 'registered'
          ? 'Clubs people added with Register a club, newest first. Their creator manages them; verify the real ones to give them the Official badge.'
          : `${venues.length} venues · ${liveCount} live now. Changes show in the app right away.`}
      </p>
      {saveError && <ErrorNote message={saveError} />}
      {view === 'registered' && registrations.loading && !registrations.data ? (
        <Spinner />
      ) : view === 'registered' && registrations.error && !registrations.data ? (
        <ErrorNote message={registrations.error} />
      ) : shown.length === 0 ? (
        <div className={`${panelCard} text-center py-10`}>
          <Store className="w-10 h-10 text-wa-quiet mx-auto mb-2" />
          <p className={`text-sm ${mutedText}`}>
            {q ? 'No venue matches.' : view === 'registered' ? 'No one has registered a club yet.' : 'No venues yet.'}
          </p>
        </div>
      ) : (
        shown.map((v) => {
          const live = isVenueLive(v);
          const left = v.status !== 'not_active' ? timeLeft(v.status_expires_at) : null;
          const reg = regById.get(v.id);
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
              {reg && (
                <div className="flex items-center gap-2 flex-wrap mb-2.5 -mt-1">
                  <span className={`text-xs ${mutedText}`}>
                    Registered by <span className={`font-semibold ${bodyText}`}>{registrations.data?.people[reg.created_by]?.display_name ?? 'a deleted user'}</span>
                    {' · '}{formatDateTime(reg.created_at)}
                  </span>
                  <Chip>{v.is_verified ? 'Verified' : 'Unverified'}</Chip>
                  <button
                    onClick={() => verify(v, !v.is_verified)}
                    disabled={busy !== null}
                    className={`${ghostBtn} !px-3 !py-1.5 text-xs ml-auto`}
                  >
                    <BadgeCheck className="w-3.5 h-3.5" />
                    {v.is_verified ? 'Remove badge' : 'Verify'}
                  </button>
                </div>
              )}
              <VenueStatusButtons venue={v} busy={busy} onSet={set} />
            </div>
          );
        })
      )}
      {editing && <VenueProfileModal venue={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
