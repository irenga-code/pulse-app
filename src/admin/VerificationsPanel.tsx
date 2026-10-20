import { useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { Spinner, ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { Chip, StatusChip, FilterToggle, panelCard } from '@/admin/shared';
import { formatDateTime } from '@/lib/time';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useToast } from '@/context/ToastContext';
import type { PublicProfile, VerificationRequest } from '@/lib/types';
import { memUserKey } from '@/lib/cache';
import { useAuth } from '@/context/AuthContext';

function RequestCard({ req, who, venueName, onDone }: { req: VerificationRequest; who?: PublicProfile; venueName?: string; onDone: () => void }) {
  const { show } = useToast();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminReviewVerification(req.id, mode === 'approve', note);
      show(mode === 'approve' ? 'Approved' : 'Rejected');
      onDone();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div className={panelCard}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`font-semibold text-sm ${bodyText}`}>{who?.display_name ?? 'Unknown user'}</span>
        <Chip>{req.kind === 'host' ? 'Performer / Staff' : 'Venue account'}</Chip>
        {req.kind === 'host' && req.role && <Chip>{req.role}</Chip>}
        {req.kind === 'venue' && <Chip>{venueName ?? 'venue'}</Chip>}
        <StatusChip status={req.status} />
        <span className={`text-[11px] ml-auto ${mutedText}`}>{formatDateTime(req.created_at)}</span>
      </div>
      {req.message && <p className={`text-sm mt-2.5 leading-relaxed ${bodyText}`}>{req.message}</p>}
      {req.note && <p className={`text-xs mt-2 ${mutedText}`}>Admin note: {req.note}</p>}

      {req.status === 'pending' &&
        (mode ? (
          <div className="mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder space-y-2.5">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={mode === 'approve' ? 'Note (optional)' : 'Reason (sent to the user)'} className={inputClass} />
            {error && <ErrorNote message={error} />}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm {mode}
              </button>
              <button onClick={() => setMode(null)} disabled={busy} className={ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mt-3">
            <button onClick={() => setMode('approve')} className={primaryBtn}>Approve</button>
            <button onClick={() => setMode('reject')} className={ghostBtn}>Reject</button>
          </div>
        ))}
    </div>
  );
}

export default function VerificationsPanel() {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const { venues } = useVenues();
  const { user } = useAuth();
  const data = useAsync(async () => {
    const rows = await api.adminListVerifications(filter);
    const people = await api.profilesByIds(rows.map((r) => r.user_id));
    return { rows, people };
  }, [], user ? memUserKey(user.id, `admin-verifications:${filter}`) : null);

  return (
    <div className="space-y-3">
      <FilterToggle value={filter} onChange={setFilter} options={[{ value: 'pending', label: 'Pending' }, { value: 'all', label: 'All' }]} />
      {data.loading && !data.data ? (
        <Spinner />
      ) : data.error ? (
        <ErrorNote message={data.error} />
      ) : data.data!.rows.length === 0 ? (
        <div className={`${panelCard} text-center py-10`}>
          <BadgeCheck className="w-10 h-10 text-wa-green mx-auto mb-2" />
          <p className={`text-sm ${mutedText}`}>{filter === 'pending' ? 'No pending requests.' : 'No requests yet.'}</p>
        </div>
      ) : (
        data.data!.rows.map((r) => (
          <RequestCard key={r.id} req={r} who={data.data!.people[r.user_id]} venueName={venues.find((v) => v.id === r.venue_id)?.name} onDone={data.reload} />
        ))
      )}
    </div>
  );
}
