import { useEffect, useState } from 'react';
import { LogIn, Eye, EyeOff, Loader2, KeyRound, Smartphone, ArrowLeft, MessageSquareText } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { authErrorMessage } from '@/lib/authErrors';
import { useToast } from '@/context/ToastContext';
import { joinE164, formatPhone, PHONE_AUTH_MODE } from '@/lib/phone';
import CountryPhoneInput, { usePhoneCountry } from '@/components/auth/CountryPhoneInput';

function PasswordInput({ value, onChange, autoComplete, placeholder }: {
  value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={`${inputClass} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1 ${mutedText}`}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

const RESEND_SECONDS = 30;
const link = 'text-wa-green font-semibold';

/**
 * Phone-only sign in / create account (Supabase Auth); both modes share this one layout.
 * - 'mapped' (default, development): phone + password. The account is a Supabase email account derived from the
 *   number (see phoneToEmail); the address never appears on screen.
 * - 'sms' (VITE_PHONE_AUTH=sms): a 6-digit SMS code signs in or creates the account; sign in can also use phone +
 *   password, and a new account can set an optional password.
 */
function PhoneForm({ signup, onDone, onSwitchMode }: { signup: boolean; onDone: () => void; onSwitchMode: () => void }) {
  const { sendPhoneCode, verifyPhoneCode, signInWithPhone, signUpWithPhone, setNewPassword } = useAuth();
  const sms = PHONE_AUTH_MODE === 'sms';
  const { country, setIso } = usePhoneCountry();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [withPassword, setWithPassword] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const passwordSignIn = !signup && (withPassword || !sms);
  const passwordSignUp = signup && !sms;

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const number = () => joinE164(country.dial, phone);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // a resend reuses the number the code went to
    const e164 = sentTo ?? number();
    if (!e164) return setError(`Enter a valid ${country.name} phone number.`);
    if (signup && name.trim() && (name.trim().length < 3 || name.trim().length > 30)) return setError('Display names are 3-30 characters.');
    if (signup && password && password.length < 8) return setError('Passwords are at least 8 characters (or leave it empty).');
    setBusy(true);
    setError(null);
    try {
      await sendPhoneCode(e164, signup ? name : undefined);
      setSentTo(e164);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(authErrorMessage(err));
    }
    setBusy(false);
  };

  const signInPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = number();
    if (!e164) return setError(`Enter a valid ${country.name} phone number.`);
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      await signInWithPhone(e164, password);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  const signUpPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = number();
    if (!e164) return setError(`Enter a valid ${country.name} phone number.`);
    if (name.trim() && (name.trim().length < 3 || name.trim().length > 30)) return setError('Display names are 3-30 characters.');
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    setBusy(true);
    setError(null);
    try {
      await signUpWithPhone(e164, password, name);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the text message.');
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneCode(sentTo, code);
      // optional password for phone + password sign-in later; the account works without it
      if (signup && password) await setNewPassword(password).catch(() => undefined);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  const smsOff = error?.startsWith('SMS codes are not switched on');

  if (sentTo) {
    return (
      <form onSubmit={verify} className="space-y-3.5" noValidate>
        <p className={`text-sm ${bodyText}`}>Enter the 6-digit code we texted to <b>{formatPhone(sentTo)}</b>.</p>
        <Field label="Code">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
            placeholder="123456" aria-label="Verification code" className={`${inputClass} tracking-[0.5em] text-center text-lg font-semibold`} autoFocus />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy || code.length !== 6} className={`${primaryBtn} w-full`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}Verify and continue
        </button>
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={() => { setSentTo(null); setError(null); }} className={`inline-flex items-center gap-1 ${link}`}>
            <ArrowLeft className="w-3.5 h-3.5" />Change number
          </button>
          <button type="button" onClick={() => send()} disabled={wait > 0 || busy} className={`${link} disabled:opacity-50`}>
            {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={passwordSignUp ? signUpPassword : passwordSignIn ? signInPassword : send} className="space-y-3.5" noValidate>
      <CountryPhoneInput country={country} onCountry={setIso} value={phone} onChange={setPhone}
        hint={sms && !passwordSignIn ? 'We text you a 6-digit code.' : undefined} />
      {signup && (
        <Field label="Display name" hint="Optional. 3-30 characters; you can change it later.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" placeholder="e.g. jane_doe" className={inputClass} />
        </Field>
      )}
      {(signup || passwordSignIn) && (
        <Field label={signup && sms ? 'Password (optional)' : 'Password'}
          hint={!signup ? undefined : sms ? 'At least 8 characters. Lets you also sign in with your number and password.' : 'At least 8 characters.'}>
          <PasswordInput value={password} onChange={setPassword} autoComplete={signup ? 'new-password' : 'current-password'}
            placeholder={signup ? 'Create a password' : 'Your password'} />
        </Field>
      )}
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : passwordSignIn || passwordSignUp ? <LogIn className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
        {passwordSignUp ? 'Create account' : passwordSignIn ? 'Sign in' : 'Send code'}
      </button>
      {sms && !signup && (
        <button type="button" onClick={() => { setWithPassword((v) => !v); setError(null); }}
          className={`flex items-center justify-center gap-1.5 w-full text-xs ${link} ${smsOff && !withPassword ? 'animate-pulse' : ''}`}>
          {withPassword ? <><MessageSquareText className="w-3.5 h-3.5" />Text me a code instead</> : <><KeyRound className="w-3.5 h-3.5" />Sign in with password instead</>}
        </button>
      )}
      <p className={`text-xs text-center ${mutedText}`}>
        {signup ? 'Already have an account? ' : 'New to Pulse? '}
        <button type="button" onClick={onSwitchMode} className={link}>{signup ? 'Sign in' : 'Create account'}</button>
      </p>
      <p className={`text-[11px] text-center ${mutedText}`}>{sms ? 'Standard SMS rates may apply. ' : ''}Your number stays private.</p>
    </form>
  );
}

function SignInUpModal() {
  const { authUi, closeAuth, openAuth } = useAuth();
  const { show } = useToast();
  // phone only: an old "forgot password" link into the modal lands on sign in
  const signup = authUi.mode === 'signup';
  return (
    <Modal title={signup ? 'Create your account' : 'Sign in'} icon={LogIn} onClose={closeAuth}>
      {authUi.reason && <p className="text-xs rounded-xl px-3 py-2 mb-4 bg-wa-green/10 text-wa-green">{authUi.reason}</p>}
      <PhoneForm key={signup ? 'signup' : 'signin'} signup={signup}
        onSwitchMode={() => openAuth(signup ? 'signin' : 'signup', authUi.reason ?? undefined)}
        onDone={() => { closeAuth(); show(signup ? 'Welcome to Pulse!' : 'Signed in'); }} />
    </Modal>
  );
}

/** Shown when the user lands from a password-reset email link. */
function ResetPasswordModal() {
  const { setNewPassword, clearRecovery } = useAuth();
  const { show } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await setNewPassword(password);
      clearRecovery();
      show('Password updated');
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Choose a new password" icon={KeyRound} onClose={clearRecovery}>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <Field label="New password" hint="At least 8 characters.">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Update password
        </button>
      </form>
    </Modal>
  );
}

/** Mount once inside AuthProvider. */
export default function AuthModals() {
  const { authUi, recovery, session, closeAuth } = useAuth();
  // Close the sign-in modal whenever a session appears (e.g. confirmed in another tab).
  useEffect(() => {
    if (session && authUi.open) closeAuth();
  }, [session, authUi.open, closeAuth]);

  return (
    <>
      {authUi.open && !session && <SignInUpModal />}
      {recovery && session && <ResetPasswordModal />}
    </>
  );
}
