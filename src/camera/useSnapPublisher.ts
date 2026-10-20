import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { NewPostInput, Post } from '@/lib/types';
import type { CaptureResult } from '@/camera/types';

export type PublishState = 'idle' | 'uploading' | 'saving' | 'error' | 'done';

/**
 * Upload the media to Storage, then create the snap post. If the post insert fails after a successful
 * upload, the retry reuses the uploaded file instead of uploading again.
 */
export function useSnapPublisher(savePost: (input: NewPostInput) => Promise<Post>) {
  const { user, canWrite, requireAuth, refreshProfile } = useAuth();
  const [state, setState] = useState<PublishState>('idle');
  const [error, setError] = useState<string | null>(null);
  const uploaded = useRef<{ blob: Blob; url: string } | null>(null);

  const publish = useCallback(
    async (capture: CaptureResult, opts: { caption: string; venueId: string | null }) => {
      if (!requireAuth('Sign in to post snaps.') || !user) return null;
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
      try {
        let url = uploaded.current?.blob === capture.blob ? uploaded.current.url : null;
        if (!url) {
          setState('uploading');
          url = await api.uploadPostMedia(user.id, capture.blob, capture.ext);
          uploaded.current = { blob: capture.blob, url };
        }
        setState('saving');
        const post = await savePost({
          content: opts.caption.trim(),
          venue_id: opts.venueId,
          kind: 'snap',
          media_url: url,
          media_type: capture.kind,
          media_width: capture.width,
          media_height: capture.height,
          media_duration_ms: capture.durationMs !== undefined ? Math.round(capture.durationMs) : undefined,
          media_meta: capture.meta,
        });
        uploaded.current = null;
        setState('done');
        return post;
      } catch (e) {
        setState('error');
        setError(friendlyError(e));
        refreshProfile();
        return null;
      }
    },
    [user, canWrite, requireAuth, savePost, refreshProfile]
  );

  return { state, error, publish, busy: state === 'uploading' || state === 'saving', reset: () => { setState('idle'); setError(null); } };
}
