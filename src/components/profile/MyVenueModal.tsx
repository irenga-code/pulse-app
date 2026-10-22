import { useState } from 'react';
import { Store, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import Modal from '@/components/Modal';
import { Spinner, ErrorNote, Field, inputClass, primaryBtn, ghostBtn, dangerBtn, mutedText, bodyText } from '@/components/ui';
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
import { revalidateAll, userKey } from '@/lib/cache';

const roleLabel: Record<VenueRole, string> = { owner: 'Owner', manager: 'Manager', host: 'Host' };
const section = 'pt-4 border-t border-wa-lightBorder dark:border-wa-darkBorder';
const heading = `text-xs font-semibold uppercase tracking-wide mb-2 ${mutedText}`;

/**
 * Hosts and venue managers run every venue they are linked to (venue_managers): pick one, then set its status,
 * post as it, or edit its profile. Live / Sold out expire automatically.
 */
export default function MyVenueModal({ onClose, initialVenue }: { onClose: () => void; initialVenue?: Venue }) {
  const { user } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const managed = useAsync(() => api.managedVenues(user!.id), [], user ? userKey(user.id, 'managed-venue-roles') : null);
  // a just-registered venue opens selected, and shows before the venue list refresh brings it in
  const [selectedId, setSelectedId] = useState<string | null>(initialVenue?.id ?? null);
  const [minutes, setMinutes] = useState(360);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, Venue>>(initialVenue ? { [initialVenue.id]: initialVenue } : {});
  const [error, setError] = useState<string | null>(null);
  // venues deleted while this sheet is open (the lists refresh a moment later)
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState<Venue | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const links = (managed.data ?? []).filter((m) => !gone.has(m.venue_id));
  const mine = (initialVenue && !gone.has(initialVenue.id) && !links.some((m) => m.venue_id === initialVenue.id)
    ? [...links, { venue_id: initialVenue.id, role: 'manager' as VenueRole }]
    : links)
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

  const removeVenue = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteMyVenue(deleting.id);
      setGone((g) => new Set(g).add(deleting.id));
      setSelectedId(null);
      show(`${deleting.name} was deleted`);
      setDeleting(null);
      revalidateAll();
    } catch (e) {
      setDeleteError(friendlyError(e));
    }
    setDeleteBusy(false);
  };

  // the confirmation replaces this sheet rather than stacking on it, so Esc / Cancel come back here
  if (deleting) {
    return (
      <Modal title="Delete venue?" icon={AlertTriangle} onClose={() => { setDeleting(null); setDeleteError(null); }}>
        <p className={`text-sm font-semibold ${bodyText}`}>Are you sure you want to delete this venue?</p>
        <p className={`text-sm mt-2 leading-relaxed ${mutedText}`}>
          <span className={`font-semibold ${bodyText}`}>{deleting.name}</span> will be removed from Pulse for good, with its
          events, reviews, followers and staff links. Posts that mention it stay, without the venue tag. This can not be undone.
        </p>
        {deleteError && <div className="mt-3"><ErrorNote message={deleteError} /></div>}
        <div className="flex gap-2 mt-5">
          <button onClick={removeVenue} disabled={deleteBusy} className={`${dangerBtn} flex-1`}>
            {deleteBusy && <Loader2 className="w-4 h-4 animate-spin" />}Delete venue
          </button>
          <button onClick={() => { setDeleting(null); setDeleteError(null); }} disabled={deleteBusy} className={`${ghostBtn} flex-1`}>Cancel</button>
        </div>
      </Modal>
    );
  }

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

          {current.venue.created_by === user?.id && (
            <>
              <div className={section}>
                <h4 className={heading}>Name &amp; location</h4>
                <RenameVenueForm key={current.venue.id} venue={current.venue} onSaved={(v) => patchVenue(current.venue, { name: v.name, location: v.location })} />
              </div>
              <div className={section}>
                <h4 className={heading}>Delete venue</h4>
                <p className={`text-xs mb-2 ${mutedText}`}>You registered {current.venue.name}, so you can remove it from Pulse.</p>
                <button onClick={() => setDeleting(current.venue)} className={`${ghostBtn} !border-wa-live/50 !text-wa-live w-full`}>
                  <Trash2 className="w-4 h-4" />Delete {current.venue.name}
                </button>
              </div>
            </>
          )}

          <p className={`text-[11px] leading-relaxed ${mutedText}`}>
            Followers get an alert when you go live. Posts made as a verified venue show the Official badge.
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Only the person who registered a venue can rename it (rename_my_venue, migration 13). */
function RenameVenueForm({ venue, onSaved }: { venue: Venue; onSaved: (v: Venue) => void }) {
  const { show } = useToast();
  const [name, setName] = useState(venue.name);
  const [location, setLocation] = useState(venue.location);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== venue.name || location.trim() !== venue.location;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const l = location.trim();
    if (n.length < 2 || n.length > 60) return setError('Name must be 2-60 characters.');
    if (l.length < 2 || l.length > 60) return setError('City / area must be 2-60 characters.');
    setBusy(true);
    setError(null);
    try {
      const v = await api.renameMyVenue(venue.id, n, l);
      onSaved(v);
      show('Venue name updated');
      revalidateAll();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === '23505' ? `There is already a ${n} in ${l}.` : friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
      </Field>
      <Field label="City / area">
        <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} className={inputClass} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy || !changed} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}Save name &amp; location
      </button>
    </form>
  );
}
