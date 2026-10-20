import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { prefetch } from '@/lib/cache';
import { isVenueLive } from '@/lib/venues';
import { useAsync } from '@/hooks/useAsync';
import type { Venue } from '@/lib/types';

type Options = {
  /** Only return venues with this status (filtered server-side). */
  status?: Venue['status'];
  /** Column to sort by, ascending. */
  orderBy?: 'created_at' | 'name';
};

const EMPTY: Venue[] = [];
const venuesKey = (status: Options['status'], orderBy: NonNullable<Options['orderBy']>) => `venues:${status ?? 'all'}:${orderBy}`;

// ---------------------------------------------------------------- one live connection for every venue list on screen
let channelCounter = 0;
const live = new Set<() => void>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let interval: number | undefined;
let soon: number | undefined;

const refreshAll = () => live.forEach((fn) => fn());
const refreshSoon = () => { window.clearTimeout(soon); soon = window.setTimeout(refreshAll, 300); };

function acquireLive(refresh: () => void) {
  live.add(refresh);
  if (!channel) {
    channel = supabase
      .channel(`venues-changes-${++channelCounter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venues' }, refreshSoon)
      // an event starting, ending early or being cancelled changes venues_public.is_live
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, refreshSoon)
      .subscribe();
    interval = window.setInterval(refreshAll, 60_000);
  }
  return () => {
    live.delete(refresh);
    if (!live.size && channel) {
      supabase.removeChannel(channel);
      channel = null;
      window.clearInterval(interval);
      window.clearTimeout(soon);
    }
  };
}

/**
 * Single source of truth for reading venues.
 * - Reads `venues_public`, whose status already accounts for expiry
 *   (a "Live" venue whose time ran out shows as Not active).
 * - Cached: every screen asking for the same list shares one request and paints the last list instantly.
 * - One realtime subscription (venues and events) for all lists, plus a re-check every minute so expiry
 *   and event start/end times show up without a reload.
 */
export function useVenues({ status, orderBy = 'created_at' }: Options = {}) {
  const key = venuesKey(status, orderBy);
  const { data, loading, error, reload } = useAsync(() => api.listVenues({ status, orderBy }), [], key);
  useEffect(() => acquireLive(() => { void reload(); }), [reload]);
  return { venues: data ?? EMPTY, loading, error, reload };
}

/** Warm the lists the main tabs use. */
export function prefetchVenues() {
  prefetch(venuesKey(undefined, 'name'), () => api.listVenues({ orderBy: 'name' }));
  prefetch(venuesKey(undefined, 'created_at'), () => api.listVenues({ orderBy: 'created_at' }));
}

/** How many venues are live right now (0 while loading), for the app-wide LIVE indicator. */
export function useLiveVenueCount() {
  const { venues } = useVenues({ orderBy: 'name' });
  return venues.filter(isVenueLive).length;
}
