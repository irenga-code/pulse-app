import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { prefetch, readCache, userKey, writeCache } from '@/lib/cache';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { emojiFor, useReactionPalette } from '@/hooks/useReactionPalette';
import { makeBursts, type Burst } from '@/components/reactions/bursts';
import type { NewPostInput, Post, PublicProfile, ReactionCounts, ReactionKind } from '@/lib/types';

let channelCounter = 0;

type ReactionRow = { post_id?: string; user_id?: string; kind?: string };

type FeedSnapshot = {
  posts: Post[];
  authors: Record<string, PublicProfile>;
  counts: Record<string, ReactionCounts>;
  mine: Record<string, ReactionKind>;
};

/** Your own reactions are part of the snapshot, so a signed-in feed is stored per person. */
const feedKey = (userId: string | null) => (userId ? userKey(userId, 'feed') : 'feed:anon');

/** Posts, their authors, reaction counts and (signed in) your reactions, in one go. */
export async function loadFeed(userId: string | null): Promise<FeedSnapshot> {
  const posts = await api.listPosts();
  const ids = posts.map((p) => p.id);
  const [authors, counts, mine] = await Promise.all([
    api.profilesByIds(posts.map((p) => p.user_id).filter((x): x is string => !!x)),
    api.reactionCounts(ids),
    userId ? api.myReactions(userId, ids) : Promise.resolve({} as Record<string, ReactionKind>),
  ]);
  return { posts, authors, counts, mine };
}

export function prefetchFeed(userId: string | null) {
  prefetch(feedKey(userId), () => loadFeed(userId));
}

/**
 * Community feed with live reactions.
 *  - posts / authors / reaction counts / my reactions
 *  - Realtime: other people's reactions update counts instantly and spawn a floating emoji on the post;
 *    new posts and comments arrive without a refresh; removed posts disappear.
 *  - Own taps are applied optimistically and reverted if the database refuses them.
 */
export function useFeed() {
  const { user, requireAuth, refreshProfile } = useAuth();
  const { show } = useToast();
  const palette = useReactionPalette();
  const userId = user?.id ?? null;

  // the last feed this person saw paints at once; the network refresh replaces it quietly
  const cached = readCache<FeedSnapshot>(feedKey(userId));
  const [posts, setPosts] = useState<Post[]>(cached?.posts ?? []);
  const [authors, setAuthors] = useState<Record<string, PublicProfile>>(cached?.authors ?? {});
  const [counts, setCounts] = useState<Record<string, ReactionCounts>>(cached?.counts ?? {});
  const [mine, setMine] = useState<Record<string, ReactionKind>>(cached?.mine ?? {});
  const [bursts, setBursts] = useState<Record<string, Burst[]>>({});
  const [loading, setLoading] = useState(!cached);
  const [loadedKey, setLoadedKey] = useState<string | null>(cached ? feedKey(userId) : null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Set<string>>(new Set());
  const postsRef = useRef<Post[]>([]);
  const paletteRef = useRef(palette);
  const userIdRef = useRef(userId);
  postsRef.current = posts;
  paletteRef.current = palette;
  userIdRef.current = userId;

  const spawnBurst = useCallback((postId: string, emoji: string, count = 1) => {
    setBursts((b) => ({ ...b, [postId]: [...(b[postId] ?? []).slice(-12), ...makeBursts(emoji, count)] }));
  }, []);
  const dismissBurst = useCallback((postId: string, id: number) => {
    setBursts((b) => (b[postId] ? { ...b, [postId]: b[postId].filter((x) => x.id !== id) } : b));
  }, []);

  const load = useCallback(async () => {
    try {
      const snap = await loadFeed(userId);
      setPosts(snap.posts);
      setAuthors(snap.authors);
      setCounts(snap.counts);
      setMine(snap.mine);
      setLoadedKey(feedKey(userId));
      setError(null);
    } catch (e) {
      // keep showing what we have; only a feed with nothing on screen reports the error
      if (!postsRef.current.length) setError((e as Error).message);
    }
    setLoading(false);
  }, [userId]);

  // signing in or out switches to that person's snapshot (or a cold load)
  useEffect(() => {
    const key = feedKey(userId);
    if (loadedKey === key) return;
    const snap = readCache<FeedSnapshot>(key);
    setPosts(snap?.posts ?? []);
    setAuthors(snap?.authors ?? {});
    setCounts(snap?.counts ?? {});
    setMine(snap?.mine ?? {});
    setLoading(!snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // keep the snapshot current (optimistic reactions, realtime counts, removed posts) for the next visit
  useEffect(() => {
    if (loadedKey !== feedKey(userId)) return;
    writeCache(feedKey(userId), { posts, authors, counts, mine } satisfies FeedSnapshot);
  }, [loadedKey, userId, posts, authors, counts, mine]);

  /** Cheap re-sync of counts only (focus / interval) to correct any missed realtime event. */
  const resync = useCallback(async () => {
    const ids = postsRef.current.map((p) => p.id);
    if (!ids.length) return;
    try {
      const [c, m] = await Promise.all([
        api.reactionCounts(ids),
        userIdRef.current ? api.myReactions(userIdRef.current, ids) : Promise.resolve({} as Record<string, ReactionKind>),
      ]);
      setCounts(c);
      setMine(m);
    } catch { /* keep what we have */ }
  }, []);

  useEffect(() => {
    load();
    let timer: number | undefined;
    const reloadSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 500);
    };
    const dropPost = (id?: string) => id && setPosts((p) => p.filter((x) => x.id !== id));

    const onReaction = (payload: { eventType: string; new: ReactionRow; old: ReactionRow }) => {
      const n = payload.new ?? {};
      const o = payload.old ?? {};
      const postId = n.post_id ?? o.post_id;
      if (!postId || !postsRef.current.some((p) => p.id === postId)) return;
      if ((n.user_id ?? o.user_id) === userIdRef.current) return; // my own taps are already applied
      setCounts((prev) => {
        const next = { ...(prev[postId] ?? {}) };
        if (payload.eventType !== 'INSERT' && o.kind) next[o.kind] = Math.max(0, (next[o.kind] ?? 0) - 1);
        if (payload.eventType !== 'DELETE' && n.kind) next[n.kind] = (next[n.kind] ?? 0) + 1;
        return { ...prev, [postId]: next };
      });
      if (payload.eventType === 'DELETE' && !o.kind) resync(); // replica identity not full: re-read
      if (payload.eventType !== 'DELETE' && n.kind) spawnBurst(postId, emojiFor(paletteRef.current, n.kind), 1);
    };

    const channel = supabase
      .channel(`feed-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, reloadSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const row = payload.new as Partial<Post>;
        if (row.status && row.status !== 'visible') dropPost(row.id);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => dropPost((payload.old as Partial<Post>).id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, onReaction as never)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (payload) => {
        const row = payload.new as { post_id?: string; user_id?: string };
        if (!row.post_id || row.user_id === userIdRef.current) return;
        setPosts((p) => p.map((x) => (x.id === row.post_id ? { ...x, comments: x.comments + 1 } : x)));
      })
      .subscribe();

    const interval = window.setInterval(resync, 60_000);
    const onVisible = () => { if (!document.hidden) resync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [load, resync, spawnBurst]);

  const react = useCallback(
    async (postId: string, kind: ReactionKind) => {
      if (!requireAuth('Sign in to react to posts.') || !userId) return;
      if (pending.current.has(postId)) return;
      pending.current.add(postId);
      const current = mine[postId] ?? null;
      const prevCounts = counts;
      const prevMine = mine;

      // optimistic update
      const next = { ...(counts[postId] ?? {}) };
      if (current) next[current] = Math.max(0, (next[current] ?? 0) - 1);
      if (current !== kind) next[kind] = (next[kind] ?? 0) + 1;
      setCounts({ ...counts, [postId]: next });
      const nextMine = { ...mine };
      if (current === kind) delete nextMine[postId];
      else {
        nextMine[postId] = kind;
        spawnBurst(postId, emojiFor(palette, kind), 4);
      }
      setMine(nextMine);

      try {
        await api.setReaction(postId, userId, kind, current);
      } catch (e) {
        setCounts(prevCounts);
        setMine(prevMine);
        show(friendlyError(e), 'error');
        refreshProfile();
      }
      pending.current.delete(postId);
    },
    [requireAuth, userId, mine, counts, palette, spawnBurst, show, refreshProfile]
  );

  /** Publish any post (text or camera snap), then show it right away. */
  const publish = useCallback(
    async (input: NewPostInput) => {
      const created = await api.createPost(input);
      await load();
      return created;
    },
    [load]
  );

  const createPost = useCallback((content: string, venueId: string | null) => publish({ content, venue_id: venueId }).then(() => undefined), [publish]);

  const removeOwnPost = useCallback(
    async (postId: string) => {
      try {
        await api.deletePost(postId);
        setPosts((p) => p.filter((x) => x.id !== postId));
      } catch (e) {
        show(friendlyError(e), 'error');
      }
    },
    [show]
  );

  const adminRemovePost = useCallback(
    async (postId: string) => {
      try {
        await api.adminSetContentStatus('post', postId, 'removed', 'Removed by a moderator from the feed.');
        setPosts((p) => p.filter((x) => x.id !== postId));
        show('Post removed');
      } catch (e) {
        show(friendlyError(e), 'error');
      }
    },
    [show]
  );

  const bumpComments = useCallback((postId: string, delta: number) => {
    setPosts((p) => p.map((x) => (x.id === postId ? { ...x, comments: Math.max(0, x.comments + delta) } : x)));
  }, []);

  return {
    posts, authors, counts, mine, bursts, loading, error,
    reload: load, react, publish, createPost, removeOwnPost, adminRemovePost, bumpComments, dismissBurst,
  };
}
