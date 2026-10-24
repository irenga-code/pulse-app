import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { MessageMedia, NewPostInput, Post } from '@/lib/types';
import type { CaptureResult } from '@/camera/types';

/** Where a Quick-Snap can go. Several can be picked at once (Snapchat "Send To"). */
export type SnapDestination =
  | { kind: 'feed' }
  | { kind: 'status' }
  | { kind: 'channel'; channelId: string; label: string }
  | { kind: 'chat'; conversationId: string; label: string };

export const destinationKey = (d: SnapDestination) =>
  d.kind === 'channel' ? `channel:${d.channelId}` : d.kind === 'chat' ? `chat:${d.conversationId}` : d.kind;

export const destinationLabel = (d: SnapDestination) =>
  d.kind === 'feed' ? 'Pulse feed' : d.kind === 'status' ? 'My status' : d.label;

export type PublishState = 'idle' | 'uploading' | 'saving' | 'error' | 'done';
export type DispatchResult = { sent: SnapDestination[]; failed: { destination: SnapDestination; error: string }[] };

/**
 * Upload the snap once, then deliver it to every destination. A failure on one destination does not stop the
 * others; retrying only re-sends the failed ones and reuses the uploaded file.
 */
export function useSnapDispatch(savePost: (input: NewPostInput) => Promise<Post>) {
  const { user, canWrite, requireAuth, refreshProfile } = useAuth();
  const [state, setState] = useState<PublishState>('idle');
  const [error, setError] = useState<string | null>(null);
  const uploaded = useRef<{ blob: Blob; url: string } | null>(null);

  const dispatch = useCallback(
    async (capture: CaptureResult, destinations: SnapDestination[], opts: { caption: string; venueId: string | null }): Promise<DispatchResult | null> => {
      if (!requireAuth('Sign in to send snaps.') || !user) return null;
      if (destinations.length === 0) {
        setState('error');
        setError('Pick at least one place to send it.');
        return null;
      }
      if (!canWrite) {
        setState('error');
        setError('Your account is suspended, so you can read but not post.');
        return null;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setState('error');
        setError('You are offline. Check your connection and try again.');
        return null;
      }
      setError(null);
      let url = uploaded.current?.blob === capture.blob ? uploaded.current.url : null;
      try {
        if (!url) {
          setState('uploading');
          url = await api.uploadPostMedia(user.id, capture.blob, capture.ext);
          uploaded.current = { blob: capture.blob, url };
        }
      } catch (e) {
        setState('error');
        setError(friendlyError(e));
        return null;
      }

      setState('saving');
      const media: MessageMedia = { media_url: url, media_type: capture.kind };
      const caption = opts.caption.trim();
      const result: DispatchResult = { sent: [], failed: [] };
      for (const d of destinations) {
        try {
          if (d.kind === 'feed') {
            await savePost({
              content: caption,
              venue_id: opts.venueId,
              kind: 'snap',
              media_url: url,
              media_type: capture.kind,
              media_width: capture.width,
              media_height: capture.height,
              media_duration_ms: capture.durationMs !== undefined ? Math.round(capture.durationMs) : undefined,
              media_meta: capture.meta,
            });
          } else if (d.kind === 'status') {
            await api.createStatus({ media_url: url, media_type: capture.kind, caption, venue_id: opts.venueId });
          } else if (d.kind === 'channel') {
            await api.postChannelMessage(d.channelId, { body: caption || null, media });
          } else {
            await api.sendMessage(d.conversationId, caption || (capture.kind === 'video' ? '🎥 Snap' : '📸 Snap'), null, media);
          }
          result.sent.push(d);
        } catch (e) {
          result.failed.push({ destination: d, error: friendlyError(e) });
        }
      }

      if (result.failed.length === 0) {
        uploaded.current = null;
        setState('done');
      } else {
        setState('error');
        setError(result.failed.map((f) => `${destinationLabel(f.destination)}: ${f.error}`).join(' · '));
        refreshProfile();
      }
      return result;
    },
    [user, canWrite, requireAuth, savePost, refreshProfile]
  );

  const reset = useCallback(() => { setState('idle'); setError(null); }, []);
  return { state, error, dispatch, busy: state === 'uploading' || state === 'saving', reset };
}
