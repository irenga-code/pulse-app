/**
 * Per-chat choices that only affect this device: mute, chat theme (wallpaper) and "clear chat" (hide everything
 * before a moment). Kept in localStorage; useChatPrefs() re-renders on changes from any component or tab.
 */
export type ChatThemeId = 'default' | 'midnight' | 'ocean' | 'forest' | 'rose' | 'sand';
export const CHAT_THEMES: { id: ChatThemeId; label: string; swatch: string; className: string }[] = [
  { id: 'default', label: 'Default', swatch: '#f0e2c8', className: '' },
  { id: 'midnight', label: 'Midnight', swatch: '#1e1b4b', className: 'bg-indigo-950/60' },
  { id: 'ocean', label: 'Ocean', swatch: '#0c4a6e', className: 'bg-sky-900/30 dark:bg-sky-950/60' },
  { id: 'forest', label: 'Forest', swatch: '#14532d', className: 'bg-emerald-900/20 dark:bg-emerald-950/60' },
  { id: 'rose', label: 'Rose', swatch: '#fda4af', className: 'bg-rose-100 dark:bg-rose-950/50' },
  { id: 'sand', label: 'Sand', swatch: '#fde68a', className: 'bg-amber-50 dark:bg-amber-950/40' },
];

/**
 * mutedUntil: conversation -> ISO time the mute ends, or 'always'. deletedAt: "Delete chat" moment; the chat leaves the
 * list until a newer message arrives (and everything before it stays hidden, like clearedAt).
 */
export type ChatPrefs = {
  mutedUntil: Record<string, string>; themes: Record<string, ChatThemeId>; clearedAt: Record<string, string>; deletedAt: Record<string, string>;
};
const KEY = 'pulse:chat-prefs';
const listeners = new Set<() => void>();

function load(): ChatPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ChatPrefs> & { muted?: string[] };
    // earlier versions kept a plain list of muted chats: those stay muted for good
    const legacy = Object.fromEntries((Array.isArray(p.muted) ? p.muted : []).map((id) => [id, 'always']));
    return { mutedUntil: { ...legacy, ...(p.mutedUntil ?? {}) }, themes: p.themes ?? {}, clearedAt: p.clearedAt ?? {}, deletedAt: p.deletedAt ?? {} };
  } catch {
    return { mutedUntil: {}, themes: {}, clearedAt: {}, deletedAt: {} };
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

/** WhatsApp's mute choices. */
export const MUTE_OPTIONS: { label: string; ms: number | 'always' }[] = [
  { label: 'For 8 hours', ms: 8 * 3600_000 },
  { label: 'For 1 week', ms: 7 * 24 * 3600_000 },
  { label: 'Always', ms: 'always' },
];

/** Muted right now (a timed mute that has run out no longer counts). */
export function isMutedIn(prefs: ChatPrefs, conversationId: string | null | undefined, now = Date.now()) {
  const until = conversationId ? prefs.mutedUntil[conversationId] : undefined;
  return !!until && (until === 'always' || new Date(until).getTime() > now);
}
export const isChatMuted = (conversationId: string | null | undefined) => isMutedIn(state, conversationId);
export function muteChat(conversationId: string, ms: number | 'always') {
  const until = ms === 'always' ? 'always' : new Date(Date.now() + ms).toISOString();
  save({ ...state, mutedUntil: { ...state.mutedUntil, [conversationId]: until } });
}
export function unmuteChat(conversationId: string) {
  const rest = { ...state.mutedUntil };
  delete rest[conversationId];
  save({ ...state, mutedUntil: rest });
}
/** Kept for the Contact info switch: on = muted always. */
export const setChatMuted = (conversationId: string, muted: boolean) => (muted ? muteChat(conversationId, 'always') : unmuteChat(conversationId));

export const chatThemeOf = (conversationId: string | null | undefined) => (conversationId && state.themes[conversationId]) || 'default';
export const setChatTheme = (conversationId: string, theme: ChatThemeId) =>
  save({ ...state, themes: { ...state.themes, [conversationId]: theme } });

/** Messages created before this moment are hidden on this device. */
export const chatClearedAt = (conversationId: string | null | undefined) => (conversationId ? state.clearedAt[conversationId] ?? null : null);
export const clearChat = (conversationId: string, at = new Date().toISOString()) =>
  save({ ...state, clearedAt: { ...state.clearedAt, [conversationId]: at } });
/** Delete chat: cleared, and out of the list until someone sends a new message (this device only). */
export const deleteChat = (conversationId: string, at = new Date().toISOString()) =>
  save({ ...state, clearedAt: { ...state.clearedAt, [conversationId]: at }, deletedAt: { ...state.deletedAt, [conversationId]: at } });

/** What the WhatsApp options Pulse cannot do yet say when tapped. */
export const NO_CALLS = 'Voice and video calls are not available in Pulse yet.';
export const NO_LISTS = 'Chat lists are not available in Pulse yet. Use Favorites to group chats for now.';
