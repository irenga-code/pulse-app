import { useState } from 'react';
import { Search, Loader2, UserCog, Check, Mail } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import { Spinner, ErrorNote, inputClass, primaryBtn, ghostBtn, dangerBtn, mutedText, bodyText } from '@/components/ui';
import { Chip, StatusChip, panelCard } from '@/admin/shared';
import { formatDateTime } from '@/lib/time';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { StaffCandidate, VenueRole, VenueStaffRow, PublicProfile } from '@/lib/types';
import { memUserKey } from '@/lib/cache';

type AssignRole = 'manager' | 'host';
const roleLabel: Record<VenueRole, string> = { owner: 'Owner', manager: 'Manager', host: 'Host' };
const roleChoices: { role: AssignRole; label: string; hint: string }[] = [
  { role: 'manager', label: 'Manager', hint: 'Runs the venue' },
  { role: 'host', label: 'Host', hint: 'DJ, MC, promoter' },
];

/** Picks a user (display name or exact email), a venue and a role, then links them via admin_assign_venue_staff. */
function AssignForm({ onAssigned }: { onAssigned: () => void }) {
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<StaffCandidate | null>(null);
  const [venueId, setVenueId] = useState('');
  const [role, setRole] = useState<AssignRole>('manager');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return setError('Type at least 2 characters.');
    setSearching(true);
    setError(null);
    try {
      const found = await api.adminFindUsers(query);
      setResults(found);
      if (found.length === 1) setPicked(found[0]);
    } catch (err) {
      setError(friendlyError(err));
    }
    setSearching(false);
  };

  const assign = async () => {
    if (!picked || !venueId) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminAssignVenueStaff(picked.id, venueId, role);
      const venue = venues.find((v) => v.id === venueId);
      show(`${picked.display_name} is now ${roleLabel[role]} of ${venue?.name ?? 'the venue'}`);
      setPicked(null);
      setResults(null);
      setQuery('');
      setVenueId('');
      onAssigned();
    } catch (err) {
      setError(friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <div className={`${panelCard} space-y-3`}>
      <h3 className={`font-semibold text-sm ${bodyText}`}>Link a user to a venue</h3>

      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Display name or exact email"
            aria-label="Find a user" className={`${inputClass} pl-9`} />
        </div>
        <button type="submit" disabled={searching} className={ghostBtn}>
          {searching && <Loader2 className="w-4 h-4 animate-spin" />}Find
        </button>
      </form>

      {results && (
        results.length === 0 ? (
          <p className={`text-xs ${mutedText}`}>No user matches. Emails must be typed in full.</p>
        ) : (
          <div className="space-y-1.5" role="radiogroup" aria-label="Matching users">
            {results.map((u) => {
              const active = picked?.id === u.id;
              return (
                <button key={u.id} type="button" role="radio" aria-checked={active} onClick={() => setPicked(u)}
                  className={`flex items-center gap-2.5 w-full text-left rounded-xl px-2.5 py-2 border transition-colors ${
                    active ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green'
                  }`}>
                  <Avatar name={u.display_name} url={u.avatar_url} size={28} />
                  <span className={`text-sm font-medium truncate ${bodyText}`}>{u.display_name}</span>
                  <RoleBadge accountType={u.account_type} verified={u.is_verified} />
                  {u.status !== 'active' && <StatusChip status={u.status} />}
                  {u.matched_email && <Mail className={`w-3.5 h-3.5 ${mutedText}`} aria-label="Email match" />}
                  {active && <Check className="w-4 h-4 text-wa-green ml-auto flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)} aria-label="Venue" className={inputClass}>
          <option value="">Choose a venue</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.location}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
          {roleChoices.map((r) => (
            <button key={r.role} type="button" role="radio" aria-checked={role === r.role} onClick={() => setRole(r.role)}
              className={`rounded-xl px-2 py-1.5 border text-left transition-colors ${
                role === r.role ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder'
              }`}>
              <span className={`block text-xs font-semibold ${bodyText}`}>{r.label}</span>
              <span className={`block text-[10px] ${mutedText}`}>{r.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      <button onClick={assign} disabled={busy || !picked || !venueId} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {picked ? `Link ${picked.display_name} as ${roleLabel[role]}` : 'Pick a user to link'}
      </button>
    </div>
  );
}

function StaffRow({ row, profile, venueName, onRemoved }: { row: VenueStaffRow; profile?: PublicProfile; venueName: string; onRemoved: () => void }) {
  const { show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = profile?.display_name ?? row.user_id.slice(0, 8);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.adminUnassignVenueStaff(row.user_id, row.venue_id);
      show(`${name} unlinked from ${venueName}`);
      onRemoved();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className={panelCard}>
      <div className="flex items-center gap-3">
        <Avatar name={name} url={profile?.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-semibold text-sm ${bodyText}`}>{name}</span>
            <Chip>{roleLabel[row.role]}</Chip>
            {profile && profile.status !== 'active' && <StatusChip status={profile.status} />}
          </div>
          <p className={`text-[11px] mt-0.5 ${mutedText}`}>{venueName} · since {formatDateTime(row.created_at)}</p>
        </div>
        {!confirming && (
          <button onClick={() => setConfirming(true)} className="text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-wa-live/50 text-wa-live">
            Unlink
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder space-y-2.5">
          <p className={`text-xs ${bodyText}`}>
            Unlink <b>{name}</b> from <b>{venueName}</b>? They lose status, profile and posting rights for this venue right away.
          </p>
          {error && <ErrorNote message={error} />}
          <div className="flex gap-2">
            <button onClick={remove} disabled={busy} className={dangerBtn}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}Unlink
            </button>
            <button onClick={() => { setConfirming(false); setError(null); }} disabled={busy} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Venue managers / hosts: who is linked to which venue (venue_managers). Writes go through logged admin RPCs. */
export default function StaffPanel() {
  const { user } = useAuth();
  const { venues } = useVenues({ orderBy: 'name' });
  const [filter, setFilter] = useState('');
  const staff = useAsync(async () => {
    const rows = await api.adminListVenueStaff();
    const profiles = await api.profilesByIds(rows.map((r) => r.user_id));
    return { rows, profiles };
  }, [], user ? memUserKey(user.id, 'admin-venue-staff') : null);

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? 'Unknown venue';
  const q = filter.trim().toLowerCase();
  const rows = (staff.data?.rows ?? []).filter((r) =>
    !q || `${venueName(r.venue_id)} ${staff.data?.profiles[r.user_id]?.display_name ?? ''} ${r.role}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <AssignForm onAssigned={staff.reload} />

      <div className="flex items-center gap-2 pt-2">
        <h3 className={`font-semibold text-sm ${bodyText}`}>Current assignments</h3>
        {staff.data && <span className={`text-xs ${mutedText}`}>{staff.data.rows.length}</span>}
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by venue, name or role"
          aria-label="Filter assignments" className={`${inputClass} !w-auto flex-1 min-w-0 ml-auto py-1.5 text-xs`} />
      </div>

      {staff.loading && !staff.data ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorNote message={staff.error} />
      ) : rows.length === 0 ? (
        <div className={`${panelCard} text-center py-10`}>
          <UserCog className="w-10 h-10 text-wa-quiet mx-auto mb-2" />
          <p className={`text-sm ${mutedText}`}>{q ? 'No assignment matches.' : 'No venue staff yet.'}</p>
        </div>
      ) : (
        rows.map((r) => (
          <StaffRow key={`${r.venue_id}:${r.user_id}`} row={r} profile={staff.data?.profiles[r.user_id]}
            venueName={venueName(r.venue_id)} onRemoved={staff.reload} />
        ))
      )}
    </div>
  );
}
