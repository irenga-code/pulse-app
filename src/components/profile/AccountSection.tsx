import { useState } from 'react';
import { Mail, KeyRound, Trash2, Loader2 } from 'lucide-react';
import { Field, ErrorNote, inputClass, primaryBtn, ghostBtn, dangerBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { authErrorMessage } from '@/lib/authErrors';
import { useToast } from '@/context/ToastContext';
import { friendlyError } from '@/lib/api';

type Panel = 'email' | 'password' | 'delete' | null;

/** Account controls inside Settings (signed-in users only). */
export default function AccountSection({ onClose }: { onClose: () => void }) {
  const { user, changeEmail, setNewPassword, deleteAccount } = useAuth();
  const { show } = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setValue('');
    setConfirm('');
    setError(null);
  };

  const run = async (fn: () => Promise<void>, ok: string, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      show(ok);
      setPanel(null);
      if (close) onClose();
    } catch (e) {
      setError(authErrorMessage(e) || friendlyError(e));
    }
    setBusy(false);
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())) return setError('Enter a valid email address.');
    run(() => changeEmail(value), 'Check your inbox to confirm the new email address.');
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.length < 8) return setError('Password must be at least 8 characters.');
    if (value !== confirm) return setError('The two passwords do not match.');
    run(() => setNewPassword(value), 'Password updated');
  };

  const row = 'w-full flex items-center gap-3 py-3 text-left';

  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide mt-5 mb-1 ${mutedText}`}>Account</p>
      <p className={`text-xs mb-1 ${mutedText}`}>Signed in as {user?.email}. Only you can see this.</p>

      <div className="divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
        <button className={row} onClick={() => open('email')} aria-expanded={panel === 'email'}>
          <Mail className={`w-5 h-5 ${mutedText}`} /><span className={`text-sm font-medium ${bodyText}`}>Change email</span>
        </button>
        {panel === 'email' && (
          <form onSubmit={submitEmail} className="py-3 space-y-3" noValidate>
            <Field label="New email"><input type="email" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="email" className={inputClass} /></Field>
            {error && <ErrorNote message={error} />}
            <button type="submit" disabled={busy} className={primaryBtn}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send confirmation</button>
          </form>
        )}

        <button className={row} onClick={() => open('password')} aria-expanded={panel === 'password'}>
          <KeyRound className={`w-5 h-5 ${mutedText}`} /><span className={`text-sm font-medium ${bodyText}`}>Change password</span>
        </button>
        {panel === 'password' && (
          <form onSubmit={submitPassword} className="py-3 space-y-3" noValidate>
            <Field label="New password" hint="At least 8 characters."><input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" className={inputClass} /></Field>
            <Field label="Confirm new password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} /></Field>
            {error && <ErrorNote message={error} />}
            <button type="submit" disabled={busy} className={primaryBtn}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Update password</button>
          </form>
        )}

        <button className={row} onClick={() => open('delete')} aria-expanded={panel === 'delete'}>
          <Trash2 className="w-5 h-5 text-wa-live" /><span className="text-sm font-medium text-wa-live">Delete my account</span>
        </button>
        {panel === 'delete' && (
          <div className="py-3 space-y-3">
            <p className={`text-xs leading-relaxed ${mutedText}`}>
              This permanently deletes your account and everything you posted, commented, saved or followed. It cannot be undone.
            </p>
            {error && <ErrorNote message={error} />}
            <div className="flex gap-2">
              <button onClick={() => open(null)} disabled={busy} className={ghostBtn}>Cancel</button>
              <button onClick={() => run(deleteAccount, 'Your account was deleted', true)} disabled={busy} className={dangerBtn}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Delete forever
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
