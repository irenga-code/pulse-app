import { useState } from 'react';
import { BadgeCheck, Check, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, Spinner, ErrorNote, inputClass, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { VERIFICATION_ROLES, type VerificationRole } from '@/lib/types';
import { userKey } from '@/lib/cache';

const statusStyle = {
  pending: 'bg-wa-busy/15 text-wa-busy',
  approved: 'bg-wa-green/15 text-wa-green',
  rejected: 'bg-wa-live/15 text-wa-live',
} as const;

const tabs = [['host', 'Performer / Staff'], ['venue', 'Venue account']] as const;

const pill = (on: boolean) =>
  `inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50 ${
    on ? 'border-wa-green bg-wa-green/10 text-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText}`
  }`;

/** Ask the Pulse team to verify you as a performer / staff member (with your role) or as the account of one or more venues. */
export default function VerificationModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const requests = useAsync(() => api.myVerificationRequests(user!.id), [], user ? userKey(user.id, 'verification-requests') : null);
  const [kind, setKind] = useState<'host' | 'venue'>('host');
  const [role, setRole] = useState<VerificationRole | null>(null);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const venueName = (id: string | null) => venues.find((v) => v.id === id)?.name ?? 'a venue';
  const pendingVenueIds = new Set(
    (requests.data ?? []).filter((r) => r.status === 'pending' && r.kind === 'venue' && r.venue_id).map((r) => r.venue_id!)
  );
  // the database allows one pending Performer / Staff request at a time
  const hostPending = (requests.data ?? []).find((r) => r.status === 'pending' && r.kind === 'host');
  const hasPending = kind === 'host' ? !!hostPending : venues.length > 0 && venues.every((v) => pendingVenueIds.has(v.id));
  const toggleVenue = (id: string) =>
    setVenueIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const switchTab = (k: 'host' | 'venue') => {
    setKind(k);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // a venue that already has a pending request is not sent again (the database allows one pending request per venue)
    const selected = venueIds.filter((id) => !pendingVenueIds.has(id));
    if (kind === 'host' && !role) return setError('Choose your role.');
    if (kind === 'venue' && selected.length === 0) return setError('Choose at least one venue.');
    if (message.trim().length < 10) return setError('Tell us a little about who you are (at least 10 characters).');
    setBusy(true);
    setError(null);
    try {
      await api.requestVerification(kind === 'host' ? { kind, role, message } : { kind, venue_ids: selected, message });
      show(kind === 'venue' && selected.length > 1 ? `${selected.length} requests sent. We will review them soon.` : 'Request sent. We will review it soon.');
      setMessage('');
      setVenueIds([]);
      setRole(null);
      await requests.reload();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === '23505' ? 'You already have a pending request for this.' : friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <Modal title="Get verified" icon={BadgeCheck} onClose={onClose}>
      <p className={`text-xs leading-relaxed mb-4 ${mutedText}`}>
        Verified performers, staff and venue accounts get a badge. Venue accounts can update their venue's live status and post official updates.
      </p>
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-2" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              onClick={() => switchTab(k)}
              aria-selected={kind === k}
              className={`rounded-xl py-2.5 text-sm font-medium border transition-colors ${
                kind === k ? 'border-wa-green bg-wa-green/10 text-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {kind === 'host' ? (
          <fieldset>
            <legend className={`block text-xs font-semibold mb-1.5 ${bodyText}`}>What is your role?</legend>
            <div className="flex flex-wrap gap-2">
              {VERIFICATION_ROLES.map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r} className={pill(role === r)}>
                  {role === r && <Check className="w-3.5 h-3.5" />}
                  {r}
                </button>
              ))}
            </div>
            {hostPending && (
              <span className={`block text-[11px] mt-1 ${mutedText}`}>
                Your {hostPending.role ?? 'Performer / Staff'} request is being reviewed.
              </span>
            )}
          </fieldset>
        ) : (
          <fieldset>
            <legend className={`block text-xs font-semibold mb-1.5 ${bodyText}`}>Which venues do you run?</legend>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {venues.map((v) => {
                const pending = pendingVenueIds.has(v.id);
                const on = !pending && venueIds.includes(v.id);
                return (
                  <button key={v.id} type="button" onClick={() => toggleVenue(v.id)} disabled={pending} aria-pressed={on} className={pill(on)}>
                    {on && <Check className="w-3.5 h-3.5" />}
                    {v.name} · {v.location}{pending && ' (pending)'}
                  </button>
                );
              })}
            </div>
            <span className={`block text-[11px] mt-1 ${mutedText}`}>
              {venueIds.length > 0 ? `${venueIds.length} selected. Each venue is reviewed separately.` : 'Pick one or more.'}
            </span>
          </fieldset>
        )}
        <Field label="Tell us about you" hint="Where you work, how we can reach you to confirm, links to your socials.">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} className={`${inputClass} resize-none`} />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy || hasPending} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {hasPending ? 'Request pending' : 'Send request'}
        </button>
      </form>

      <p className={`text-xs font-semibold uppercase tracking-wide mt-6 mb-2 ${mutedText}`}>Your requests</p>
      {requests.loading ? (
        <Spinner />
      ) : (requests.data ?? []).length === 0 ? (
        <p className={`text-xs ${mutedText}`}>No requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {requests.data!.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm rounded-xl px-3 py-2 border border-wa-lightBorder dark:border-wa-darkBorder">
              <span className={`flex-1 ${bodyText}`}>{r.kind === 'host' ? (r.role ?? 'Performer / Staff') : `Venue: ${venueName(r.venue_id)}`}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${statusStyle[r.status]}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
