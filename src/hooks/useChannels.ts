import { useCallback, useState } from 'react';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { userKey } from '@/lib/cache';

/** Venue channels with what you follow and which ones you can post to (venue staff, admins). */
export function useChannels() {
  const { user, isAdmin } = useAuth();
  const { show } = useToast();
  const data = useAsync(async () => {
    const [channels, follows, managed] = await Promise.all([
      api.listChannels(),
      user ? api.myChannelFollows(user.id) : Promise.resolve([] as string[]),
      user ? api.managedVenueIds(user.id) : Promise.resolve([] as string[]),
    ]);
    return { channels, follows, managed };
  }, [], user ? userKey(user.id, 'channels') : 'channels:anon');
  // optimistic follow state until the next reload
  const [local, setLocal] = useState<Record<string, boolean>>({});

  const isFollowing = useCallback((id: string) => local[id] ?? (data.data?.follows ?? []).includes(id), [local, data.data]);
  const canPost = useCallback(
    (venueId: string) => isAdmin || (data.data?.managed ?? []).includes(venueId),
    [isAdmin, data.data],
  );

  const toggleFollow = useCallback(async (id: string) => {
    if (!user) return;
    const was = isFollowing(id);
    setLocal((l) => ({ ...l, [id]: !was }));
    try {
      if (was) await api.unfollowChannel(id, user.id);
      else await api.followChannel(id);
      void data.reload();
    } catch (e) {
      setLocal((l) => ({ ...l, [id]: was }));
      show(friendlyError(e), 'error');
    }
  }, [user, isFollowing, data, show]);

  return {
    channels: data.data?.channels ?? [],
    managed: data.data?.managed ?? [],
    loading: data.loading && !data.data,
    error: data.error,
    reload: data.reload,
    isFollowing,
    canPost,
    toggleFollow,
  };
}
