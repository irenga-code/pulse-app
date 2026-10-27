import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { stableContext } from '@/lib/stableContext';

type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
/** 'auto' = the Pulse green (Emerald, #10b981) in both modes. */
export type Accent = 'auto' | 'emerald' | 'blue' | 'navy' | 'violet' | 'amber' | 'yellow' | 'orange' | 'hotpink' | 'softpink';
export const ACCENTS: { id: Exclude<Accent, 'auto'>; label: string; swatch: string }[] = [
  { id: 'emerald', label: 'Emerald Green', swatch: '#10b981' },
  { id: 'blue', label: 'Electric Blue', swatch: '#3b82f6' },
  { id: 'navy', label: 'Navy Blue', swatch: '#4338ca' },
  { id: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { id: 'amber', label: 'Amber', swatch: '#f59e0b' },
  { id: 'yellow', label: 'Yellow', swatch: '#facc15' },
  { id: 'orange', label: 'Orange', swatch: '#f97316' },
  { id: 'hotpink', label: 'Hot Pink', swatch: '#db2777' },
  { id: 'softpink', label: 'Soft Pink', swatch: '#fda4af' },
];
const MODE_KEY = 'pulse_theme_mode';
const ACCENT_KEY = 'pulse_accent_color';

type ThemeContextValue = {
  /** The theme on screen right now ("system" resolved). */
  theme: Theme;
  preference: ThemePreference;
  toggleTheme: () => void;
  setTheme: (theme: ThemePreference) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  /** The accent on screen right now ('auto' resolved). */
  activeAccent: Exclude<Accent, 'auto'>;
};

const ThemeContext = stableContext<ThemeContextValue | undefined>('theme', undefined);

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    // 'pulse-theme' is where earlier versions kept it
    const stored = read(MODE_KEY) ?? read('pulse-theme');
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  });
  const [systemDark, setSystemDark] = useState(() => systemQuery()?.matches ?? true);
  const [accent, setAccentState] = useState<Accent>(() => {
    const stored = read(ACCENT_KEY);
    return ACCENTS.some((a) => a.id === stored) ? (stored as Accent) : 'auto';
  });

  useEffect(() => {
    const q = systemQuery();
    if (!q) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    q.addEventListener?.('change', onChange);
    return () => q.removeEventListener?.('change', onChange);
  }, []);

  const theme: Theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    write(MODE_KEY, preference);
  }, [theme, preference]);

  const activeAccent = accent === 'auto' ? 'emerald' : accent;
  useEffect(() => {
    // the accent colour variables in index.css switch on this attribute
    document.documentElement.dataset.accent = activeAccent;
    write(ACCENT_KEY, accent);
  }, [accent, activeAccent]);

  const toggleTheme = useCallback(() => setPreference(theme === 'dark' ? 'light' : 'dark'), [theme]);

  return (
    <ThemeContext.Provider value={{ theme, preference, toggleTheme, setTheme: setPreference, accent, setAccent: setAccentState, activeAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
