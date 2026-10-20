import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInto, readCache, registerRevalidator, subscribeCache, writeCache } from '@/lib/cache';

/**
 * Run an async loader on mount / when deps change, with reload().
 *
 * With a `key` it is stale-while-revalidate: the last data for that key (memory or localStorage) shows
 * immediately, the loader refreshes it in the background, and every component using the key stays in sync.
 * `loading` is only true when there is nothing to show yet (a cold first load); `refreshing` is true during
 * any request. `error` is only reported while there is no data: a failed background refresh keeps the old data.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], key: string | null = null) {
  const [data, setLocal] = useState<T | null>(() => (key ? readCache<T>(key) ?? null : null));
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    const k = keyRef.current;
    setRefreshing(true);
    try {
      const result = k ? await fetchInto(k, () => loaderRef.current()) : await loaderRef.current();
      if (id !== seq.current) return;
      setLocal(result);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError((e as Error).message || 'Something went wrong');
    }
    if (id === seq.current) setRefreshing(false);
  }, []);

  // a different key shows that key's cached data at once (or nothing) instead of the previous key's
  useEffect(() => {
    if (key) setLocal(readCache<T>(key) ?? null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const offCache = subscribeCache(key, () => setLocal(readCache<T>(key) ?? null));
    const offRevalidate = registerRevalidator(key, () => { void reload(); });
    return () => { offCache(); offRevalidate(); };
  }, [key, reload]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [...deps, key]);

  const setData = useCallback((next: T) => {
    const k = keyRef.current;
    if (k) writeCache(k, next);
    else setLocal(next);
  }, []);

  return {
    data,
    loading: refreshing && data === null,
    refreshing,
    error: data === null ? error : null,
    reload,
    setData,
  };
}
