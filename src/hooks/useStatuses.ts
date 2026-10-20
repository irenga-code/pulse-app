import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { readCache, userKey, writeCache } from '@/lib/cache';
import { useAuth } from '@/context/AuthContext';
import type { PublicProfile, Status } from '@/lib/types';

let channelCounter = 0;

export type StatusGroup = {
  userId: string;
  items: Status[];
  /** at least one status you have not seen yet (your own are never "unseen") */
  unseen: boolean;
  isMine: boolean;
};

/** Order: your own first, then people with unseen statuses (newest first), then the ones you have already seen. */
export function groupStatuses(items: Status[], seen: Set<string>, myId: string | null, now = Date.now()): StatusGroup[] {
  const byUser = new Map<string, Status[]>();
  for (const s of items) {
    if (new Date(s.expires_at).getTime() <= now) continue;
    byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  }
  const groups: StatusGroup[] = [...byUser.entries()].map(([userId, list]) => {
    const sorted = list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const isMine = userId === myId;
    return { userId, items: sorted, isMine, unseen: !isMine && sorted.some((s) => !seen.has(s.id)) };
  });
  const latest = (g: StatusGroup) => g.items[g.items.length - 1].created_at;
  const rank = (g: StatusGroup) => (g.isMine ? 0 : g.unseen ? 1 : 2);
  return groups.sort((a, b) => rank(a) - rank(b) || latest(b).localeCompare(latest(a)));
}

type Snapshot = { items: Status[]; authors: Record<string, PublicProfile>; seen: string[] };
const statusesKey = (userId: string | null) => (userId ? userKey(userId, 'statuses') : 'statuses:anon');

/** Live statuses (24 h stories): who posted, which ones you have seen, realtime new/removed ones. */
export function useStatuses() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // the tray paints from the last visit (expired statuses are filtered out by time below)
  const cached = readCache<Snapshot>(statusesKey(userId));
  const [items, setItems] = useState<Status[]>(cached?.items ?? []);
  const [authors, setAuthors] = useState<Record<string, PublicProfile>>(cached?.authors ?? {});
  const [seen, setSeen] = useState<Set<string>>(() => new Set(cached?.seen ?? []));
  const [loading, setLoading] = useState(!cached);
  const [now, setNow] = useState(() => Date.now());
  const sent = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const rows = await api.listStatuses();
      const [people, views] = await Promise.all([
        api.profilesByIds(rows.map((r) => r.user_id)),
        userId ? api.myStatusViews(userId) : Promise.resolve([] as string[]),
      ]);
      setItems(rows);
      setAuthors(people);
      setSeen(new Set(views));
      writeCache(statusesKey(userId), { items: rows, authors: people, seen: views } satisfies Snapshot);
    } catch {
      /* the tray is optional: keep what we have */
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const snap = readCache<Snapshot>(statusesKey(userId));
    if (snap) {
      setItems(snap.items);
      setAuthors(snap.authors);
      setSeen(new Set(snap.seen));
    }
    setLoading(!snap);
    load();
    let t: number | undefined;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(load, 500); };
    const channel = supabase
      .channel(`statuses-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'statuses' }, soon)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'statuses' }, soon)
      .subscribe();
    return () => { window.clearTimeout(t); supabase.removeChannel(channel); };
  }, [load, userId]);

  // expired statuses disappear from the screen on their own
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const groups = useMemo(() => groupStatuses(items, seen, userId, now), [items, seen, userId, now]);

  /** Remember that you saw a status (and tell the owner). Your own statuses are not counted. */
  const markViewed = useCallback((status: Status) => {
    if (!userId || status.user_id === userId || sent.current.has(status.id)) return;
    sent.current.add(status.id);
    setSeen((s) => new Set(s).add(status.id));
    api.markStatusViewed(status.id).catch(() => { sent.current.delete(status.id); });
  }, [userId]);

  return { groups, authors, loading, reload: load, markViewed };
}
