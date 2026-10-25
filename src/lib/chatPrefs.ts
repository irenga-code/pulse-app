/**
 * Per-chat choices that only affect this device: mute, chat theme (wallpaper) and "clear chat" (hide everything
 * before a moment). Kept in localStorage; useChatPrefs() re-renders on changes from any component or tab.
 */
export type ChatThemeId = 'default' | 'midnight' | 'ocean' | 'forest' | 'rose' | 'sand';
export const CHAT_THEMES: { id: ChatThemeId; label: string; swatch: string; className: string }[] = [
  { id: 'default', label: 'Default', swatch: '#efeae2', className: '' },
  { id: 'midnight', label: 'Midnight', swatch: '#1e1b4b', className: 'bg-indigo-950/60' },
  { id: 'ocean', label: 'Ocean', swatch: '#0c4a6e', className: 'bg-sky-900/30 dark:bg-sky-950/60' },
  { id: 'forest', label: 'Forest', swatch: '#14532d', className: 'bg-emerald-900/20 dark:bg-emerald-950/60' },
  { id: 'rose', label: 'Rose', swatch: '#fda4af', className: 'bg-rose-100 dark:bg-rose-950/50' },
  { id: 'sand', label: 'Sand', swatch: '#fde68a', className: 'bg-amber-50 dark:bg-amber-950/40' },
];

export type ChatPrefs = { muted: string[]; themes: Record<string, ChatThemeId>; clearedAt: Record<string, string> };
const KEY = 'pulse:chat-prefs';
const listeners = new Set<() => void>();

function load(): ChatPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ChatPrefs>;
    return { muted: Array.isArray(p.muted) ? p.muted : [], themes: p.themes ?? {}, clearedAt: p.clearedAt ?? {} };
  } catch {
    return { muted: [], themes: {}, clearedAt: {} };
  }
}
let state = load();

function save(next: ChatPrefs) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* per-device convenience only */ }
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); listeners.forEach((fn) => fn()); } });
}

export const getChatPrefs = () => state;
export function subscribeChatPrefs(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const isChatMuted = (conversationId: string | null | undefined) => !!conversationId && state.muted.includes(conversationId);
export const setChatMuted = (conversationId: string, muted: boolean) =>
  save({ ...state, muted: muted ? [...new Set([...state.muted, conversationId])] : state.muted.filter((id) => id !== conversationId) });

export const chatThemeOf = (conversationId: string | null | undefined) => (conversationId && state.themes[conversationId]) || 'default';
export const setChatTheme = (conversationId: string, theme: ChatThemeId) =>
  save({ ...state, themes: { ...state.themes, [conversationId]: theme } });

/** Messages created before this moment are hidden on this device. */
export const chatClearedAt = (conversationId: string | null | undefined) => (conversationId ? state.clearedAt[conversationId] ?? null : null);
export const clearChat = (conversationId: string, at = new Date().toISOString()) =>
  save({ ...state, clearedAt: { ...state.clearedAt, [conversationId]: at } });
