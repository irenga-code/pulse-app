import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { stableContext } from '@/lib/stableContext';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import type { Preferences } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useTheme, type ThemePreference } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';

export type Settings = {
  liveVenueAlerts: boolean;
  communityAlerts: boolean;
  announcements: boolean;
};

const DEFAULT_SETTINGS: Settings = { liveVenueAlerts: true, communityAlerts: true, announcements: true };
const STORAGE_KEY = 'pulse-settings';

const toColumn: Record<keyof Settings, keyof Preferences> = {
  liveVenueAlerts: 'live_venue_alerts',
  communityAlerts: 'community_alerts',
  announcements: 'announcements',
};

type SettingsContextValue = {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  /** Change the theme and, when signed in, remember it on the account. */
  setThemePreference: (theme: ThemePreference) => void;
};

const SettingsContext = stableContext<SettingsContextValue | undefined>('settings', undefined);

function loadLocal(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      liveVenueAlerts: parsed.liveVenueAlerts ?? true,
      communityAlerts: parsed.communityAlerts ?? true,
      announcements: parsed.announcements ?? true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Preferences live in `user_preferences` when signed in (so they follow you across
 * devices, and the server honours the alert toggles when it creates notifications).
 * Signed out, they are kept on this device only.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const { show } = useToast();
  const userId = user?.id ?? null;
  const [settings, setSettings] = useState<Settings>(loadLocal);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  // On sign-in, adopt the account's saved preferences.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    api.getPreferences(userId).then((p) => {
      if (!active || !p) return;
      setSettings({ liveVenueAlerts: p.live_venue_alerts, communityAlerts: p.community_alerts, announcements: p.announcements });
      if (p.theme === 'dark' || p.theme === 'light' || p.theme === 'system') setTheme(p.theme);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId, setTheme]);

  const persist = useCallback(
    (patch: Partial<Preferences>) => {
      if (!userId) return;
      api.savePreferences(userId, patch).catch((e) => show(friendlyError(e), 'error'));
    },
    [userId, show]
  );

  const setSetting = useCallback<SettingsContextValue['setSetting']>(
    (key, value) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      persist({ [toColumn[key]]: value });
    },
    [persist]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    persist({ live_venue_alerts: true, community_alerts: true, announcements: true });
  }, [persist]);

  const setThemePreference = useCallback(
    (theme: ThemePreference) => {
      setTheme(theme);
      persist({ theme });
    },
    [setTheme, persist]
  );

  const value = useMemo(
    () => ({ settings, setSetting, resetSettings, setThemePreference }),
    [settings, setSetting, resetSettings, setThemePreference]
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
