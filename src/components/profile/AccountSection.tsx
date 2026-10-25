import { useState, useSyncExternalStore } from 'react';
import { Mail, KeyRound, Trash2, Loader2, Smartphone, BadgeCheck, LogOut, Lock, Eye, MessageSquareLock } from 'lucide-react';
import { Field, ErrorNote, inputClass, primaryBtn, ghostBtn, dangerBtn, mutedText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { authErrorMessage } from '@/lib/authErrors';
import { useToast } from '@/context/ToastContext';
import { friendlyError } from '@/lib/api';
import { joinE164, formatPhone, isPulseLocalEmail, phoneFromPulseEmail } from '@/lib/phone';
import { getDesktopPrefs, setNotificationPreviews, subscribeDesktopPrefs } from '@/lib/desktopNotifications';
import CountryPhoneInput, { usePhoneCountry } from '@/components/auth/CountryPhoneInput';
import { SettingsGroup, SettingsRow, Toggle } from '@/components/settings/SettingsUi';

type Panel = 'phone' | 'email' | 'password' | 'delete' | null;

/** Settings > Account: your number (read-only once confirmed), privacy, password, sign out and delete. */
export default function AccountSection({ onClose }: { onClose: () => void }) {
  const { user, profile, changeEmail, setNewPassword, deleteAccount, addPhone, confirmPhone, signOut } = useAuth();
  const { show } = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // phone: the number a code was texted to (step 2)
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const { country, setIso } = usePhoneCountry();
  const desktop = useSyncExternalStore(subscribeDesktopPrefs, getDesktopPrefs, getDesktopPrefs);
  const confirmedPhone = user?.phone ? `+${user.phone.replace(/^\+/, '')}` : null;
  // phone + password accounts (dev mapping) sign in with a number that was not confirmed by SMS
  const mappedPhone = confirmedPhone ? null : phoneFromPulseEmail(user?.email);
  const realEmail = user?.email && !isPulseLocalEmail(user.email) ? user.email : null;

  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setValue('');
    setConfirm('');
    setError(null);
    setCodeFor(null);
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

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeFor) {
      const e164 = joinE164(country.dial, value);
      if (!e164) return setError(`Enter a valid ${country.name} phone number.`);
      setBusy(true);
      setError(null);
      try {
        await addPhone(e164);
        setCodeFor(e164);
        setValue('');
      } catch (err) {
        setError(authErrorMessage(err));
      }
      setBusy(false);
      return;
    }
    if (!/^\d{6}$/.test(value.trim())) return setError('Enter the 6-digit code from the text message.');
    run(() => confirmPhone(codeFor, value), 'Phone number confirmed');
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

  const form = 'px-4 pb-4 pt-1 space-y-3';

  return (
    <div className="space-y-6">
      <SettingsGroup title="Phone number">
        {confirmedPhone ? (
          <SettingsRow icon={Smartphone} title={formatPhone(confirmedPhone)}
            description="Your registered number. Only you can see it; people can find you only if they already know it."
            trailing={profile?.phone_verified !== false && (
              <span className="inline-flex items-center gap-1 rounded-full bg-wa-green/15 text-wa-green px-2 py-0.5 text-[11px] font-semibold">
                <BadgeCheck className="w-3.5 h-3.5" />Verified
              </span>
            )} />
        ) : mappedPhone ? (
          <SettingsRow icon={Smartphone} title={formatPhone(mappedPhone)}
            description="Your registered number, used to sign in with your password. Only you can see it." />
        ) : (
          <>
            <SettingsRow icon={Smartphone} title="Add phone number" description="Sign in by SMS and let friends find you by number"
              onClick={() => open('phone')} expanded={panel === 'phone'} />
            {panel === 'phone' && (
              <form onSubmit={submitPhone} className={form} noValidate>
                {codeFor ? (
                  <Field label={`Code texted to ${formatPhone(codeFor)}`}>
                    <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
                      placeholder="123456" aria-label="Verification code" className={`${inputClass} tracking-[0.4em]`} />
                  </Field>
                ) : (
                  <CountryPhoneInput country={country} onCountry={setIso} value={value} onChange={setValue}
                    hint="Your number stays private; people can only find you if they already know it." />
                )}
                {error && <ErrorNote message={error} />}
                <button type="submit" disabled={busy} className={primaryBtn}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{codeFor ? 'Confirm number' : 'Text me a code'}</button>
              </form>
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <SettingsRow icon={Lock} title="Phone number" description="Nobody but you" />
        <SettingsRow icon={Eye} title="Profile photo, name and about" description="Everyone on Pulse" />
        <SettingsRow icon={MessageSquareLock} title="Message previews" description="Show message text in system notifications on this device"
          trailing={<Toggle checked={desktop.previews} onChange={setNotificationPreviews} label="Message previews" />} />
      </SettingsGroup>

      <SettingsGroup title="Security">
        {realEmail && (
          <>
            <SettingsRow icon={Mail} title="Email" description={realEmail} onClick={() => open('email')} expanded={panel === 'email'} />
            {panel === 'email' && (
              <form onSubmit={submitEmail} className={form} noValidate>
                <Field label="New email"><input type="email" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="email" className={inputClass} /></Field>
                {error && <ErrorNote message={error} />}
                <button type="submit" disabled={busy} className={primaryBtn}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send confirmation</button>
              </form>
            )}
          </>
        )}
        <SettingsRow icon={KeyRound} title="Password" description="Sign in with your phone number and password" onClick={() => open('password')} expanded={panel === 'password'} />
        {panel === 'password' && (
          <form onSubmit={submitPassword} className={form} noValidate>
            <Field label="New password" hint="At least 8 characters."><input type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" className={inputClass} /></Field>
            <Field label="Confirm new password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputClass} /></Field>
            {error && <ErrorNote message={error} />}
            <button type="submit" disabled={busy} className={primaryBtn}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Update password</button>
          </form>
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow icon={LogOut} title="Sign out" onClick={() => { void signOut(); onClose(); }} />
        <SettingsRow icon={Trash2} title="Delete my account" danger onClick={() => open('delete')} expanded={panel === 'delete'} />
        {panel === 'delete' && (
          <div className={form}>
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
      </SettingsGroup>
      <p className={`text-[11px] px-1 ${mutedText}`}>Signed in as {formatPhone(confirmedPhone ?? mappedPhone) || realEmail}. Only you can see this.</p>
    </div>
  );
}
