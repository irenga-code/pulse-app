import { useEffect, useState } from 'react';
import { LogIn, Eye, EyeOff, Loader2, MailCheck, KeyRound, Smartphone, Mail, ArrowLeft } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth, type AuthMode } from '@/context/AuthContext';
import { authErrorMessage } from '@/lib/authErrors';
import { useToast } from '@/context/ToastContext';
import { toE164, formatPhone } from '@/lib/phone';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function SignInForm({ onMode, onDone }: { onMode: (m: AuthMode) => void; onDone: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailRe.test(email.trim())) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} />
      </Field>
      <Field label="Password">
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
        Sign in
      </button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={() => onMode('forgot')} className="text-wa-green font-semibold">Forgot password?</button>
        <button type="button" onClick={() => onMode('signup')} className="text-wa-green font-semibold">Create account</button>
      </div>
    </form>
  );
}

function SignUpForm({ onMode, onDone }: { onMode: (m: AuthMode) => void; onDone: () => void }) {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 3 || n.length > 30) return setError('Display name must be 3-30 characters.');
    if (n.includes('@')) return setError('Your display name is public, so it can not be an email address.');
    if (!emailRe.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    setError(null);
    try {
      const { needsConfirmation } = await signUp(email, password, n);
      if (needsConfirmation) {
        setConfirmEmail(true);
        setBusy(false);
      } else {
        onDone();
      }
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  if (confirmEmail) {
    return (
      <div className="text-center py-4">
        <MailCheck className="w-10 h-10 text-wa-green mx-auto mb-3" />
        <p className={`text-sm font-semibold ${bodyText}`}>Check your email</p>
        <p className={`text-xs mt-1.5 leading-relaxed ${mutedText}`}>
          We sent a confirmation link to {email.trim()}. Open it to finish creating your account, then sign in.
        </p>
        <button onClick={() => onMode('signin')} className="mt-4 text-xs font-semibold text-wa-green">Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <Field label="Display name" hint="Public. Only this name and your photo are ever shown to others, never your real name or email.">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={30} placeholder="e.g. kampala_nights" className={inputClass} />
      </Field>
      <Field label="Email" hint="Private. Used only to sign in and recover your account.">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="Create a password" />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Create account
      </button>
      <p className={`text-[11px] text-center ${mutedText}`}>
        Already have an account? <button type="button" onClick={() => onMode('signin')} className="text-wa-green font-semibold">Sign in</button>
      </p>
    </form>
  );
}

function ForgotForm({ onMode }: { onMode: (m: AuthMode) => void }) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailRe.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <MailCheck className="w-10 h-10 text-wa-green mx-auto mb-3" />
        <p className={`text-sm font-semibold ${bodyText}`}>Check your email</p>
        <p className={`text-xs mt-1.5 leading-relaxed ${mutedText}`}>
          If an account exists for {email.trim()}, we have sent a link to reset the password.
        </p>
        <button onClick={() => onMode('signin')} className="mt-4 text-xs font-semibold text-wa-green">Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <p className={`text-xs leading-relaxed ${mutedText}`}>Enter your email and we will send you a link to choose a new password.</p>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Send reset link
      </button>
      <button type="button" onClick={() => onMode('signin')} className="block mx-auto text-xs font-semibold text-wa-green">Back to sign in</button>
    </form>
  );
}

const RESEND_SECONDS = 30;

/**
 * Phone sign-in / sign-up with a one-time SMS code (Supabase Auth). The same flow signs in an existing number or
 * creates an account for a new one; the display name is only used for new accounts.
 */
function PhoneForm({ signup, onDone, onUseEmail }: { signup: boolean; onDone: () => void; onUseEmail: () => void }) {
  const { sendPhoneCode, verifyPhoneCode } = useAuth();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError('Enter the full number with country code, e.g. +256 700 000 000.');
    if (signup && name.trim() && (name.trim().length < 3 || name.trim().length > 30)) return setError('Display names are 3-30 characters.');
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

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the text message.');
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneCode(sentTo, code);
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  const notEnabled = error?.startsWith('Phone sign-in is not switched on');

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
          <button type="button" onClick={() => { setSentTo(null); setError(null); }} className="inline-flex items-center gap-1 text-wa-green font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" />Change number
          </button>
          <button type="button" onClick={() => send()} disabled={wait > 0 || busy} className="text-wa-green font-semibold disabled:opacity-50">
            {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="space-y-3.5" noValidate>
      <Field label="Phone number" hint="With country code. We text you a 6-digit code.">
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="+256 700 000 000"
          aria-label="Phone number" className={inputClass} />
      </Field>
      {signup && (
        <Field label="Display name" hint="Optional. 3-30 characters; you can change it later.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="nickname" className={inputClass} />
        </Field>
      )}
      {error && <ErrorNote message={error} />}
      {notEnabled && (
        <button type="button" onClick={onUseEmail} className={`${ghostBtn} w-full`}><Mail className="w-4 h-4" />Use email instead</button>
      )}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}Send code
      </button>
      <p className={`text-[11px] text-center ${mutedText}`}>Standard SMS rates may apply. Your number stays private.</p>
    </form>
  );
}

function SignInUpModal() {
  const { authUi, closeAuth, openAuth } = useAuth();
  const { show } = useToast();
  const title = authUi.mode === 'signin' ? 'Sign in' : authUi.mode === 'signup' ? 'Create your account' : 'Reset password';
  const setMode = (m: AuthMode) => openAuth(m, authUi.reason ?? undefined);
  // phone first (WhatsApp-style); email stays for existing accounts and admins
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const tabs = authUi.mode !== 'forgot' && (
    <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-xl bg-wa-lightSecondary dark:bg-wa-darkSecondary" role="tablist" aria-label="Sign-in method">
      {(['phone', 'email'] as const).map((m) => (
        <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => setMethod(m)}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
            method === m ? 'bg-wa-lightPanel dark:bg-wa-darkPanel text-wa-green shadow-sm' : mutedText
          }`}>
          {m === 'phone' ? <Smartphone className="w-4 h-4" /> : <Mail className="w-4 h-4" />}{m === 'phone' ? 'Phone' : 'Email'}
        </button>
      ))}
    </div>
  );

  return (
    <Modal title={title} icon={LogIn} onClose={closeAuth}>
      {authUi.reason && authUi.mode !== 'forgot' && (
        <p className="text-xs rounded-xl px-3 py-2 mb-4 bg-wa-green/10 text-wa-green">{authUi.reason}</p>
      )}
      {tabs}
      {authUi.mode !== 'forgot' && method === 'phone' && (
        <>
          <PhoneForm signup={authUi.mode === 'signup'} onUseEmail={() => setMethod('email')} onDone={() => { closeAuth(); show(authUi.mode === 'signup' ? 'Welcome to Pulse!' : 'Signed in'); }} />
          <p className={`text-xs text-center mt-4 ${mutedText}`}>
            {authUi.mode === 'signin' ? 'New to Pulse? ' : 'Already have an account? '}
            <button type="button" onClick={() => setMode(authUi.mode === 'signin' ? 'signup' : 'signin')} className="text-wa-green font-semibold">
              {authUi.mode === 'signin' ? 'Create account' : 'Sign in'}
            </button>
          </p>
        </>
      )}
      {authUi.mode === 'signin' && method === 'email' && (
        <SignInForm onMode={setMode} onDone={() => { closeAuth(); show('Signed in'); }} />
      )}
      {authUi.mode === 'signup' && method === 'email' && (
        <SignUpForm onMode={setMode} onDone={() => { closeAuth(); show('Welcome to Pulse!'); }} />
      )}
      {authUi.mode === 'forgot' && <ForgotForm onMode={setMode} />}
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
