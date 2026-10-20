import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

/**
 * Per-user engagement state for a list of posts: bookmarks and reposts, with optimistic updates
 * that roll back if the database refuses. (Likes are the 'heart' reaction and live in useFeed.)
 */
export function useEngagement(posts: { id: string; reposts?: number }[]) {
  const { user, requireAuth } = useAuth();
  const { show } = useToast();
  const userId = user?.id ?? null;
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [reposted, setReposted] = useState<Set<string>>(new Set());
  /**
   * Local +1/-1 on top of the loaded repost count so the number reacts immediately. `base` is the server count it was
   * applied to: once the feed reloads with a different number, the server value already includes our change.
   */
  const [repostDelta, setRepostDelta] = useState<Record<string, { base: number; d: number }>>({});
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const postIds = useMemo(() => posts.map((p) => p.id), [posts]);
  const busy = useRef<Set<string>>(new Set());
  const key = postIds.join(',');

  useEffect(() => {
    if (!userId) { setSaved(new Set()); setReposted(new Set()); return; }
    let alive = true;
    api.savedPostIds(userId).then((ids) => alive && setSaved(new Set(ids))).catch(() => undefined);
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId || postIds.length === 0) return;
    let alive = true;
    api.myRepostIds(userId, postIds).then((ids) => alive && setReposted(new Set(ids))).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key]);

  const toggleSave = useCallback(async (postId: string) => {
    if (!requireAuth('Sign in to save posts.') || !userId) return;
    if (busy.current.has(`s${postId}`)) return;
    busy.current.add(`s${postId}`);
    const was = saved.has(postId);
    setSaved((s) => { const n = new Set(s); if (was) n.delete(postId); else n.add(postId); return n; });
    try {
      if (was) await api.unsavePost(userId, postId); else await api.savePost(postId);
      show(was ? 'Removed from saved' : 'Saved to your profile');
    } catch (e) {
      setSaved((s) => { const n = new Set(s); if (was) n.add(postId); else n.delete(postId); return n; });
      show(friendlyError(e), 'error');
    }
    busy.current.delete(`s${postId}`);
  }, [requireAuth, userId, saved, show]);

  /** Repost to your followers' feed (optionally with a short quote), or undo an earlier repost. */
  const toggleRepost = useCallback(async (postId: string, comment?: string) => {
    if (!requireAuth('Sign in to repost.') || !userId) return;
    if (busy.current.has(`r${postId}`)) return;
    busy.current.add(`r${postId}`);
    const was = reposted.has(postId);
    const base = postsRef.current.find((p) => p.id === postId)?.reposts ?? 0;
    const bump = (d: number) => setRepostDelta((m) => ({ ...m, [postId]: { base: m[postId]?.base ?? base, d: (m[postId]?.d ?? 0) + d } }));
    setReposted((s) => { const n = new Set(s); if (was) n.delete(postId); else n.add(postId); return n; });
    bump(was ? -1 : 1);
    try {
      if (was) await api.unrepost(userId, postId); else await api.repost(postId, comment);
      show(was ? 'Repost removed' : 'Reposted');
    } catch (e) {
      setReposted((s) => { const n = new Set(s); if (was) n.add(postId); else n.delete(postId); return n; });
      bump(was ? 1 : -1);
      show(friendlyError(e), 'error');
    }
    busy.current.delete(`r${postId}`);
  }, [requireAuth, userId, reposted, show]);

  const repostCount = useCallback((post: { id: string; reposts?: number }) => {
    const server = post.reposts ?? 0;
    const adj = repostDelta[post.id];
    return adj && adj.base === server ? Math.max(0, server + adj.d) : server;
  }, [repostDelta]);

  return useMemo(() => ({ saved, reposted, repostCount, toggleSave, toggleRepost }), [saved, reposted, repostCount, toggleSave, toggleRepost]);
}
