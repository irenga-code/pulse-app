import { useEffect, useState } from 'react';
import { LogIn, Eye, EyeOff, Loader2, MailCheck, KeyRound } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth, type AuthMode } from '@/context/AuthContext';
import { authErrorMessage } from '@/lib/authErrors';
import { useToast } from '@/context/ToastContext';

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

function SignInUpModal() {
  const { authUi, closeAuth, openAuth } = useAuth();
  const { show } = useToast();
  const title = authUi.mode === 'signin' ? 'Sign in' : authUi.mode === 'signup' ? 'Create your account' : 'Reset password';
  const setMode = (m: AuthMode) => openAuth(m, authUi.reason ?? undefined);

  return (
    <Modal title={title} icon={LogIn} onClose={closeAuth}>
      {authUi.reason && authUi.mode !== 'forgot' && (
        <p className="text-xs rounded-xl px-3 py-2 mb-4 bg-wa-green/10 text-wa-green">{authUi.reason}</p>
      )}
      {authUi.mode === 'signin' && (
        <SignInForm onMode={setMode} onDone={() => { closeAuth(); show('Signed in'); }} />
      )}
      {authUi.mode === 'signup' && (
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
