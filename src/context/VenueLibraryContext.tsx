import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/apiClient';
import { readCache, userKey, writeCache } from '@/lib/cache';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export type SavedEntry = { venue_id: string; created_at: string };

type Value = {
  /** Saved venues, newest first. */
  saved: SavedEntry[];
  savedIds: Set<string>;
  followingIds: Set<string>;
  loading: boolean;
  error: string | null;
  isSaved: (venueId: string) => boolean;
  isFollowing: (venueId: string) => boolean;
  toggleSaved: (venueId: string) => Promise<void>;
  toggleFollow: (venueId: string) => Promise<void>;
};

const Ctx = createContext<Value | undefined>(undefined);

type Snapshot = { saved: SavedEntry[]; following: string[] };
const libraryKey = (userId: string) => userKey(userId, 'venue-library');

/**
 * The signed-in user's saved + followed venues. Requires an account:
 * signed-out taps open the sign-in modal, and every write is sent with the
 * user's JWT (Row Level Security only accepts your own rows).
 */
export function VenueLibraryProvider({ children }: { children: ReactNode }) {
  const { user, requireAuth, refreshProfile } = useAuth();
  const { show } = useToast();
  const userId = user?.id ?? null;

  const [saved, setSaved] = useState<SavedEntry[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whose saved/followed lists are in state (so optimistic changes are cached for the right person). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const pending = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      setSaved([]);
      setFollowing([]);
      setError(null);
      setLoading(false);
      setLoadedFor(null);
      return;
    }
    let active = true;
    const cached = readCache<Snapshot>(libraryKey(userId));
    if (cached) {
      setSaved(cached.saved);
      setFollowing(cached.following);
      setLoadedFor(userId);
    }
    setLoading(!cached);
    Promise.all([api.listSaved(userId), api.listVenueFollows(userId)])
      .then(([s, f]) => {
        if (!active) return;
        setSaved(s);
        setFollowing(f);
        setLoadedFor(userId);
        setError(null);
      })
      .catch((e) => active && !cached && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (userId && loadedFor === userId) writeCache(libraryKey(userId), { saved, following } satisfies Snapshot);
  }, [userId, loadedFor, saved, following]);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.venue_id)), [saved]);
  const followingIds = useMemo(() => new Set(following), [following]);

  const toggleSaved = useCallback(
    async (venueId: string) => {
      if (!requireAuth('Sign in to save venues to your profile.') || !userId) return;
      const key = `s:${venueId}`;
      if (pending.current.has(key)) return;
      pending.current.add(key);
      const was = savedIds.has(venueId);
      const previous = saved;
      setSaved(was ? previous.filter((s) => s.venue_id !== venueId) : [{ venue_id: venueId, created_at: new Date().toISOString() }, ...previous]);
      try {
        if (was) await api.unsaveVenue(userId, venueId);
        else await api.saveVenue(venueId);
        setError(null);
      } catch (e) {
        setSaved(previous);
        show(friendlyError(e), 'error');
        refreshProfile();
      }
      pending.current.delete(key);
    },
    [requireAuth, userId, savedIds, saved, show, refreshProfile]
  );

  const toggleFollow = useCallback(
    async (venueId: string) => {
      if (!requireAuth('Sign in to follow venues and get alerts when they go live.') || !userId) return;
      const key = `f:${venueId}`;
      if (pending.current.has(key)) return;
      pending.current.add(key);
      const was = followingIds.has(venueId);
      const previous = following;
      setFollowing(was ? previous.filter((id) => id !== venueId) : [...previous, venueId]);
      try {
        if (was) await api.unfollowVenue(userId, venueId);
        else await api.followVenue(venueId);
      } catch (e) {
        setFollowing(previous);
        show(friendlyError(e), 'error');
        refreshProfile();
      }
      pending.current.delete(key);
    },
    [requireAuth, userId, followingIds, following, show, refreshProfile]
  );

  const value = useMemo<Value>(
    () => ({
      saved, savedIds, followingIds, loading, error,
      isSaved: (id) => savedIds.has(id),
      isFollowing: (id) => followingIds.has(id),
      toggleSaved, toggleFollow,
    }),
    [saved, savedIds, followingIds, loading, error, toggleSaved, toggleFollow]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVenueLibrary() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVenueLibrary must be used within VenueLibraryProvider');
  return ctx;
}
