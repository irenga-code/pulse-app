import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { emojiFor, useReactionPalette } from '@/hooks/useReactionPalette';
import { makeBursts, type Burst } from '@/components/reactions/bursts';
import type { ReactionCounts, ReactionKind } from '@/lib/types';

type Value = {
  countsFor: (venueId: string) => ReactionCounts;
  mineFor: (venueId: string) => ReactionKind | null;
  burstsFor: (venueId: string) => Burst[];
  dismissBurst: (venueId: string, id: number) => void;
  react: (venueId: string, kind: ReactionKind) => Promise<void>;
};

const Ctx = createContext<Value | undefined>(undefined);
const NONE: ReactionCounts = {};
type Row = { venue_id?: string; user_id?: string; kind?: string };

/**
 * Tonight's "vibe" for every venue (reactions from the last 12 hours), live:
 * other people's vibes update the counts instantly and float an emoji over the venue card.
 */
export function VenueVibesProvider({ children }: { children: ReactNode }) {
  const { user, requireAuth, refreshProfile } = useAuth();
  const { show } = useToast();
  const palette = useReactionPalette();
  const userId = user?.id ?? null;
  const [counts, setCounts] = useState<Record<string, ReactionCounts>>({});
  const [mine, setMine] = useState<Record<string, ReactionKind>>({});
  const [bursts, setBursts] = useState<Record<string, Burst[]>>({});
  const pending = useRef<Set<string>>(new Set());
  const userIdRef = useRef(userId);
  const paletteRef = useRef(palette);
  userIdRef.current = userId;
  paletteRef.current = palette;

  const spawn = useCallback((venueId: string, emoji: string, n = 1) => {
    setBursts((b) => ({ ...b, [venueId]: [...(b[venueId] ?? []).slice(-8), ...makeBursts(emoji, n)] }));
  }, []);
  const dismissBurst = useCallback((venueId: string, id: number) => {
    setBursts((b) => (b[venueId] ? { ...b, [venueId]: b[venueId].filter((x) => x.id !== id) } : b));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api.venueVibeCounts(), userIdRef.current ? api.myVenueReactions(userIdRef.current) : Promise.resolve({})]);
      setCounts(c);
      setMine(m);
    } catch { /* keep what we have */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh, userId]);

  useEffect(() => {
    const channel = supabase
      .channel('venue-vibes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venue_reactions' }, (payload) => {
        const n = (payload.new ?? {}) as Row;
        const o = (payload.old ?? {}) as Row;
        const venueId = n.venue_id ?? o.venue_id;
        if (!venueId || (n.user_id ?? o.user_id) === userIdRef.current) return;
        setCounts((prev) => {
          const next = { ...(prev[venueId] ?? {}) };
          if (payload.eventType !== 'INSERT' && o.kind) next[o.kind] = Math.max(0, (next[o.kind] ?? 0) - 1);
          if (payload.eventType !== 'DELETE' && n.kind) next[n.kind] = (next[n.kind] ?? 0) + 1;
          return { ...prev, [venueId]: next };
        });
        if (payload.eventType !== 'DELETE' && n.kind) spawn(venueId, emojiFor(paletteRef.current, n.kind), 1);
      })
      .subscribe();
    const interval = window.setInterval(refresh, 60_000); // also lets 12h-old vibes fall off
    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [refresh, spawn]);

  const react = useCallback(
    async (venueId: string, kind: ReactionKind) => {
      if (!requireAuth('Sign in to share the vibe at a venue.') || !userId) return;
      if (pending.current.has(venueId)) return;
      pending.current.add(venueId);
      const current = mine[venueId] ?? null;
      const prevCounts = counts, prevMine = mine;
      const next = { ...(counts[venueId] ?? {}) };
      if (current) next[current] = Math.max(0, (next[current] ?? 0) - 1);
      if (current !== kind) next[kind] = (next[kind] ?? 0) + 1;
      setCounts({ ...counts, [venueId]: next });
      const nm = { ...mine };
      if (current === kind) delete nm[venueId];
      else { nm[venueId] = kind; spawn(venueId, emojiFor(palette, kind), 4); }
      setMine(nm);
      try {
        await api.setVenueReaction(venueId, userId, kind, current);
      } catch (e) {
        setCounts(prevCounts);
        setMine(prevMine);
        show(friendlyError(e), 'error');
        refreshProfile();
      }
      pending.current.delete(venueId);
    },
    [requireAuth, userId, mine, counts, palette, spawn, show, refreshProfile]
  );

  const value = useMemo<Value>(
    () => ({
      countsFor: (id) => counts[id] ?? NONE,
      mineFor: (id) => mine[id] ?? null,
      burstsFor: (id) => bursts[id] ?? [],
      dismissBurst, react,
    }),
    [counts, mine, bursts, dismissBurst, react]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVenueVibes() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVenueVibes must be used within VenueVibesProvider');
  return ctx;
}
