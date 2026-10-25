import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { phoneToEmail } from '@/lib/phone';
import { clearUserCache, readCache, userKey, writeCache } from '@/lib/cache';
import type { Profile } from '@/lib/types';

export type AuthMode = 'signin' | 'signup' | 'forgot';

type AuthUi = { open: boolean; mode: AuthMode; reason: string | null };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** True until the first session lookup finishes. */
  loading: boolean;
  /** Session AND profile/admin lookups have finished (safe to decide access). */
  ready: boolean;
  /** Signed in AND the account is allowed to write (not suspended / banned). */
  canWrite: boolean;
  authUi: AuthUi;
  openAuth: (mode?: AuthMode, reason?: string) => void;
  closeAuth: () => void;
  /** Returns true when signed in; otherwise opens the sign-in modal and returns false. */
  requireAuth: (reason?: string) => boolean;
  recovery: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  changeEmail: (email: string) => Promise<void>;
  /** Phone sign-in / sign-up: texts a one-time code (Supabase Auth SMS). A new number creates the account. */
  sendPhoneCode: (phone: string, displayName?: string) => Promise<void>;
  /** Phone + password. Dev mapping: the account is phoneToEmail(phone); also works for accounts with a confirmed phone. */
  signInWithPhone: (phone: string, password: string) => Promise<void>;
  /** Create a phone + password account (dev mapping via phoneToEmail; no SMS). */
  signUpWithPhone: (phone: string, password: string, displayName: string) => Promise<void>;
  verifyPhoneCode: (phone: string, code: string) => Promise<void>;
  /** Add or change the number on a signed-in account (email accounts too): texts a code to the new number. */
  addPhone: (phone: string) => Promise<void>;
  confirmPhone: (phone: string, code: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type CachedAccount = { profile: Profile | null; isAdmin: boolean };
const accountKey = (id: string) => userKey(id, 'account');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  /** Which user id the profile/admin lookup last finished for (never a stale id). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [authUi, setAuthUi] = useState<AuthUi>({ open: false, mode: 'signin', reason: null });
  const [recovery, setRecovery] = useState(false);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const [p, admin] = await Promise.all([api.getProfile(id), api.isAdmin(id).catch(() => false)]);
    setProfile(p);
    setIsAdmin(admin);
    writeCache(accountKey(id), { profile: p, isAdmin: admin } satisfies CachedAccount);
  }, []);

  // whoever was signed in before keeps nothing on this device once they sign out or switch accounts
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    const prev = previousUser.current;
    if (prev && prev !== userId) clearUserCache(prev);
    previousUser.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setIsAdmin(false);
      setLoadedFor(null);
      return;
    }
    let active = true;
    // the last known profile / admin flag shows at once (the database still checks every admin action)
    const cached = readCache<CachedAccount>(accountKey(userId));
    if (cached) {
      setProfile(cached.profile);
      setIsAdmin(cached.isAdmin);
      setLoadedFor(userId);
    }
    loadProfile(userId)
      .catch(() => {
        if (active && !cached) setProfile(null);
      })
      .finally(() => {
        if (active) setLoadedFor(userId);
      });
    return () => {
      active = false;
    };
  }, [userId, loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId).catch(() => undefined);
  }, [userId, loadProfile]);

  const openAuth = useCallback((mode: AuthMode = 'signin', reason?: string) => {
    setAuthUi({ open: true, mode, reason: reason ?? null });
  }, []);
  const closeAuth = useCallback(() => setAuthUi((u) => ({ ...u, open: false })), []);

  const requireAuth = useCallback(
    (reason?: string) => {
      if (session) return true;
      openAuth('signin', reason);
      return false;
    },
    [session, openAuth]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    if (await api.isDisplayNameTaken(displayName)) throw new Error('That display name is already taken. Please pick another.');
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    // With email confirmation on, an existing address comes back as a user with no identities.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error('An account with this email already exists.');
    }
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) throw error;
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const changeEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: window.location.origin });
    if (error) throw error;
  }, []);

  const sendPhoneCode = useCallback(async (phone: string, displayName?: string) => {
    if (displayName?.trim() && (await api.isDisplayNameTaken(displayName))) throw new Error('That display name is already taken. Please pick another.');
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true, data: displayName?.trim() ? { display_name: displayName.trim() } : undefined },
    });
    if (error) throw error;
  }, []);

  const signInWithPhone = useCallback(async (phone: string, password: string) => {
    const mapped = await supabase.auth.signInWithPassword({ email: phoneToEmail(phone), password });
    if (!mapped.error) return;
    // not a mapped account: it may be one with a real, SMS-confirmed number
    if (/invalid login credentials/i.test(mapped.error.message)) {
      const real = await supabase.auth.signInWithPassword({ phone, password });
      if (!real.error) return;
    }
    throw mapped.error;
  }, []);

  const signUpWithPhone = useCallback(async (phone: string, password: string, displayName: string) => {
    const name = displayName.trim();
    if (name && (await api.isDisplayNameTaken(name))) throw new Error('That display name is already taken. Please pick another.');
    // the profile row (id + display_name) is created by the database trigger from this metadata; the number stays in
    // the account's private metadata, never in the public profiles table
    const { data, error } = await supabase.auth.signUp({
      email: phoneToEmail(phone),
      password,
      options: { data: { ...(name ? { display_name: name } : {}), phone } },
    });
    if (error) throw error;
    if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('phone already registered');
    if (!data.session) throw new Error('mapped signup needs email confirmation off');
    if (name && data.user) {
      // keep the chosen name if the trigger had to adjust it (best effort)
      await api.updateProfile(data.user.id, { display_name: name }).catch(() => undefined);
    }
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: 'sms' });
    if (error) throw error;
  }, []);

  const addPhone = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.updateUser({ phone });
    if (error) throw error;
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.deleteMyAccount();
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const confirmPhone = useCallback(async (phone: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: 'phone_change' });
    if (error) throw error;
    await refreshProfile(); // phone_verified is set by the database trigger
  }, [refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      profile,
      isAdmin,
      loading,
      ready: !loading && (userId === null || loadedFor === userId),
      canWrite: !!session && (profile ? profile.status === 'active' : true),
      authUi,
      openAuth,
      closeAuth,
      requireAuth,
      recovery,
      clearRecovery: () => setRecovery(false),
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      setNewPassword,
      changeEmail,
      sendPhoneCode,
      signInWithPhone,
      signUpWithPhone,
      verifyPhoneCode,
      addPhone,
      confirmPhone,
      deleteAccount,
      refreshProfile,
    }),
    [session, user, userId, profile, isAdmin, loading, loadedFor, authUi, openAuth, closeAuth, requireAuth, recovery,
      signIn, signUp, signOut, sendPasswordReset, setNewPassword, changeEmail, sendPhoneCode, signInWithPhone, signUpWithPhone, verifyPhoneCode, addPhone, confirmPhone,
      deleteAccount, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
