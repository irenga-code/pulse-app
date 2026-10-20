import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { readCache, userKey, writeCache } from '@/lib/cache';
import type { AppNotification, NotificationType } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useSettings, type Settings } from '@/context/SettingsContext';

const LOCAL_READ_KEY = 'pulse-read-notifications';

const typeToSetting: Record<NotificationType, keyof Settings | null> = {
  venue_live: 'liveVenueAlerts',
  official_post: 'communityAlerts',
  community: 'communityAlerts',
  comment: 'communityAlerts',
  reaction: 'communityAlerts',
  follow: 'communityAlerts',
  system: 'announcements',
  event: 'announcements',
  moderation: null, // account notices are never filtered out
};

let channelCounter = 0;

type Snapshot = { rows: AppNotification[]; reads: string[] };
const notificationsKey = (userId: string | null) => (userId ? userKey(userId, 'notifications') : 'notifications:anon');

function loadLocalRead(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Notifications from Supabase (realtime), filtered by the user's alert preferences.
 * Signed in: read state is stored on the account (notification_reads).
 * Signed out: only broadcast notices are visible and read state stays on this device.
 */
export function useNotifications() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const userId = user?.id ?? null;
  const cached = readCache<Snapshot>(notificationsKey(userId));
  const [all, setAll] = useState<AppNotification[]>(cached?.rows ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(cached?.reads ?? []));

  useEffect(() => {
    let active = true;
    const key = notificationsKey(userId);
    const snap = readCache<Snapshot>(key);
    let hasData = !!snap;
    if (snap) {
      setAll(snap.rows);
      setReadIds(new Set(snap.reads));
    }

    async function load() {
      try {
        const [rows, reads] = await Promise.all([
          api.listNotifications(),
          userId ? api.listReadNotificationIds(userId) : Promise.resolve([...loadLocalRead()]),
        ]);
        if (!active) return;
        setAll(rows);
        setReadIds(new Set(reads));
        writeCache(key, { rows, reads } satisfies Snapshot);
        hasData = true;
        setError(null);
      } catch (e) {
        // a failed refresh keeps the cached list on screen
        if (active && !hasData) setError((e as Error).message);
      }
      if (active) setLoading(false);
    }

    setLoading(!hasData);
    load();

    const channel = supabase
      .channel(`notifications-changes-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        load();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const persistLocal = (next: Set<string>) => {
    try {
      localStorage.setItem(LOCAL_READ_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const notifications = useMemo(
    () =>
      all.filter((n) => {
        const key = typeToSetting[n.type] ?? null;
        return key === null || settings[key];
      }),
    [all, settings]
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !readIds.has(n.id)).length, [notifications, readIds]);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev).add(id);
        if (userId) api.markNotificationRead(id).catch(() => undefined);
        else persistLocal(next);
        return next;
      });
    },
    [userId]
  );

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      if (userId) api.markAllNotificationsRead().catch(() => undefined);
      else persistLocal(next);
      return next;
    });
  }, [notifications, userId]);

  return {
    notifications,
    hiddenByPreferences: all.length - notifications.length,
    unreadCount,
    readIds,
    loading,
    error,
    markRead,
    markAllRead,
  };
}
