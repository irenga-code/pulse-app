import { useState } from 'react';
import { BadgeCheck, Check, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, Spinner, ErrorNote, inputClass, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { VERIFICATION_ROLES, type VerificationRole } from '@/lib/types';
import { userKey } from '@/lib/cache';

const statusStyle = {
  pending: 'bg-wa-busy/15 text-wa-busy',
  approved: 'bg-wa-green/15 text-wa-green',
  rejected: 'bg-wa-live/15 text-wa-live',
} as const;

const pill = (on: boolean) =>
  `inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50 ${
    on ? 'border-wa-green bg-wa-green/10 text-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText}`
  }`;

/** Ask the Pulse team to verify you in your role (performer, staff, ...). */
export default function VerificationModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const requests = useAsync(() => api.myVerificationRequests(user!.id), [], user ? userKey(user.id, 'verification-requests') : null);
  const [role, setRole] = useState<VerificationRole | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the database allows one pending request at a time
  const pending = (requests.data ?? []).find((r) => r.status === 'pending' && r.kind === 'host');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return setError('Choose your role.');
    if (message.trim().length < 10) return setError('Tell us a little about who you are (at least 10 characters).');
    setBusy(true);
    setError(null);
    try {
      await api.requestVerification({ kind: 'host', role, message });
      show('Request sent. We will review it soon.');
      setMessage('');
      setRole(null);
      await requests.reload();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === '23505' ? 'You already have a pending request.' : friendlyError(err));
    }
    setBusy(false);
  };

  return (
    <Modal title="Get verified" icon={BadgeCheck} onClose={onClose}>
      <p className={`text-xs leading-relaxed mb-4 ${mutedText}`}>
        Verified accounts get a badge next to their name.
      </p>
      <form onSubmit={submit} className="space-y-3.5">
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
          {pending && <span className={`block text-[11px] mt-1 ${mutedText}`}>Your {pending.role ?? 'verification'} request is being reviewed.</span>}
        </fieldset>
        <Field label="Tell us about you" hint="What you do, how we can reach you to confirm, links to your socials.">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} className={`${inputClass} resize-none`} />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy || !!pending} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {pending ? 'Request pending' : 'Send request'}
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
              <span className={`flex-1 ${bodyText}`}>{r.kind === 'host' ? r.role ?? 'Performer / Staff' : 'Business account'}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${statusStyle[r.status]}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
