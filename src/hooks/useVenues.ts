<<<<<<< HEAD
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
=======
import { useState } from 'react';
export interface Venue {
  id: string;
  name: string;
  location: string;
  status: 'live' | 'sold_out' | 'inactive';
  image_url: string;
  created_at: string;
}
export function useVenues(_options?: { orderBy?: string }) {
  const [venues] = useState<Venue[]>([
    {
      id: '1',
      name: 'Taboo',
      location: 'Bugolobi, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-01'
    },
    {
      id: '2',
      name: 'Guvnor',
      location: 'Industrial Area, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-02'
    },
    {
      id: '3',
      name: 'Casablanca',
      location: 'Kisementi, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-03'
    },
    {
      id: '4',
      name: 'Nomad',
      location: 'Ggaba Road, Bunga',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-04'
    },
    {
      id: '5',
      name: 'Paradigm',
      location: 'Ggaba Road, Kansanga',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-05'
    },
    {
      id: '6',
      name: 'Autospa',
      location: 'Ggaba Road, Munyonyo',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-06'
    },
    {
      id: '7',
      name: 'Chez Boss Mtoto',
      location: 'Ggaba Road, Munyonyo',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-07'
    },
    {
      id: '8',
      name: 'Catwalk',
      location: 'Kololo, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-08'
    },
    {
      id: '9',
      name: 'Vanquish',
      location: 'Kololo, Kampala',
      status: 'live',
      image_url: 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&w=800&q=80',
      created_at: '2026-05-09'
    }
  ]);
  return { venues, loading: false };
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
}
