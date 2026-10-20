import { api } from './apiClient';
import { prefetch, userKey, wireRevalidation } from './cache';
import { prefetchVenues } from '@/hooks/useVenues';
import { prefetchFeed } from '@/hooks/useFeed';

/**
 * After the first paint, quietly load what the other tabs and the usual modals need, so switching to them
 * shows data instead of a placeholder. Also refreshes screens when the network or the app comes back.
 */
export function warmUp(userId: string | null) {
  wireRevalidation();
  const run = () => {
    prefetchVenues();
    prefetchFeed(userId);
    if (userId) {
      prefetch(userKey(userId, 'profile-stats'), () => api.profileStats(userId));
      prefetch(userKey(userId, 'managed-venues'), () => api.managedVenueIds(userId));
      prefetch(userKey(userId, 'saved-posts'), () => api.listSavedPosts(userId));
    }
    // code for the modals people open most, so their first open is instant too
    void import('@/components/social/UserProfileModal');
    void import('@/components/social/MessagesLayer');
    void import('@/components/status/StatusComposer');
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 2000 });
  else window.setTimeout(run, 400);
}
