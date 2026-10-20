/**
 * Stale-while-revalidate cache shared by the whole app.
 *
 * - Memory first, then localStorage, so a reload or a re-opened tab/modal paints the last data instantly.
 * - One request per key at a time: components asking for the same data share the in-flight promise.
 * - Subscribers of a key re-render when it changes (a save in one place updates every screen showing it).
 * - Keys that contain `u:<user id>:` hold one person's data (notifications, saved items, profile) and are
 *   wiped with `clearUserCache` on sign-out, so the next person on the device never sees them.
 * - Keys that start with `mem:` are never written to localStorage (message previews, which vanish mode must be
 *   able to erase, and moderation data).
 *
 * Bump VERSION when the shape of cached rows changes; older entries are then ignored.
 */
const VERSION = 1;
const PREFIX = `pulse-cache:v${VERSION}:`;

type Entry = { data: unknown; at: number };

const mem = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();
const revalidators = new Map<string, Set<() => void>>();

/** The key for one person's data: cleared on sign-out. */
export const userKey = (userId: string, name: string) => `u:${userId}:${name}`;
/** Same, but kept in memory only (gone on reload). */
export const memUserKey = (userId: string, name: string) => `mem:u:${userId}:${name}`;

function storageGet(key: string): Entry | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry) : undefined;
  } catch {
    return undefined;
  }
}

function storageSet(key: string, entry: Entry) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // full or blocked storage: drop our older entries once and keep going from memory
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX) && k !== PREFIX + key) localStorage.removeItem(k);
      localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch { /* memory only */ }
  }
}

export function readCache<T>(key: string): T | undefined {
  let e = mem.get(key);
  if (!e && !key.startsWith('mem:')) {
    e = storageGet(key);
    if (e) mem.set(key, e);
  }
  return e?.data as T | undefined;
}

/** When the key was last written (ms since epoch), or 0. */
export function cacheAge(key: string): number {
  const e = mem.get(key) ?? (key.startsWith('mem:') ? undefined : storageGet(key));
  return e ? Date.now() - e.at : Infinity;
}

export function writeCache<T>(key: string, data: T, persist = true) {
  const entry = { data, at: Date.now() };
  mem.set(key, entry);
  if (persist && !key.startsWith('mem:')) storageSet(key, entry);
  listeners.get(key)?.forEach((l) => l());
}

export function subscribeCache(key: string, listener: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(key);
  };
}

/**
 * Run `loader` for `key` unless a request for it is already running (then join that one).
 * The result is written to the cache; errors are passed to the caller and leave the cached data alone.
 */
export function fetchInto<T>(key: string, loader: () => Promise<T>, persist = true): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = loader()
    .then((data) => {
      writeCache(key, data, persist);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Warm a key in the background (errors are ignored: the screen will try again when it opens). */
export function prefetch<T>(key: string, loader: () => Promise<T>, maxAgeMs = 30_000) {
  if (cacheAge(key) < maxAgeMs) return;
  fetchInto(key, loader).catch(() => undefined);
}

/** Mounted screens register how to refresh themselves; `revalidateAll` (network back, tab visible) calls them. */
export function registerRevalidator(key: string, fn: () => void) {
  let set = revalidators.get(key);
  if (!set) revalidators.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) revalidators.delete(key);
  };
}

export function revalidateAll() {
  revalidators.forEach((set) => set.forEach((fn) => fn()));
}

/** Forget everything stored for one person (call on sign-out / account switch). */
export function clearUserCache(userId: string) {
  const p = `u:${userId}:`;
  for (const k of [...mem.keys()]) if (k.startsWith(p) || k.startsWith(`mem:${p}`)) mem.delete(k);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX + p)) localStorage.removeItem(k);
  } catch { /* nothing stored */ }
}

/** Tests: start from an empty cache. */
export function resetCache() {
  mem.clear();
  inflight.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch { /* nothing stored */ }
}

let wired = false;
/** Refresh what is on screen when the connection comes back or the app returns to the foreground. */
export function wireRevalidation() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('online', revalidateAll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidateAll(); });
}
