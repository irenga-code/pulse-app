import { useCallback, useEffect, useRef, useState } from 'react';
import { X, MapPin, Send } from 'lucide-react';
import Avatar from '@/components/Avatar';
import ReactionBar from '@/components/reactions/ReactionBar';
import ReactionBurst from '@/components/reactions/ReactionBurst';
import type { Burst } from '@/components/reactions/bursts';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { useAuth } from '@/context/AuthContext';
import { useSocial } from '@/context/SocialContext';
import { timeAgo, timeLeft } from '@/lib/time';
import type { Post, PublicProfile, ReactionCounts, ReactionKind } from '@/lib/types';
import { lockBodyScroll } from '@/lib/scrollLock';

const IMAGE_MS = 6000;

/**
 * Full-screen story viewer. Tap right/left for next/previous, hold to pause, Esc to close.
 * Photos play for 6 s, videos play through. Reactions are live (same data as the feed).
 */
export default function SnapViewer({ snaps, start, authors, counts, mine, bursts, onReact, onBurstDone, onClose }: {
  snaps: Post[]; start: number; authors: Record<string, PublicProfile>;
  counts: Record<string, ReactionCounts>; mine: Record<string, ReactionKind>; bursts: Record<string, Burst[]>;
  onReact: (postId: string, kind: ReactionKind) => void; onBurstDone: (postId: string, id: number) => void; onClose: () => void;
}) {
  const { user } = useAuth();
  const { openChat } = useSocial();
  const [index, setIndex] = useState(Math.min(start, snaps.length - 1));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const snap = snaps[index];

  const next = useCallback(() => { if (index >= snaps.length - 1) onClose(); else { setIndex(index + 1); setProgress(0); } }, [index, snaps.length, onClose]);
  const prev = useCallback(() => { if (index > 0) { setIndex(index - 1); setProgress(0); } else setProgress(0); }, [index]);

  // photo timer
  useEffect(() => {
    if (!snap || snap.media_type === 'video' || paused) return;
    const t0 = Date.now() - progress * IMAGE_MS;
    const id = window.setInterval(() => {
      const p = (Date.now() - t0) / IMAGE_MS;
      if (p >= 1) { window.clearInterval(id); next(); } else setProgress(p);
    }, 50);
    return () => window.clearInterval(id);
    // progress is intentionally read only when (re)starting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, snap?.id, next]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => undefined);
  }, [paused, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    const unlock = lockBodyScroll();
    return () => { window.removeEventListener('keydown', onKey); unlock(); };
  }, [next, prev, onClose]);

  if (!snap) return null;
  const author = snap.user_id ? authors[snap.user_id] : undefined;

  return (
    <div role="dialog" aria-modal="true" aria-label="Snap viewer" className="fixed inset-0 z-[65] bg-black flex items-center justify-center text-white">
      <div className="relative w-full mx-auto bg-black overflow-hidden" style={{ height: '100dvh', maxWidth: 'calc(100dvh * 9 / 16)' }}>
        {snap.media_type === 'video' ? (
          <video
            ref={videoRef}
            key={snap.id}
            src={snap.media_url ?? ''}
            autoPlay
            playsInline
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration > 0 && Number.isFinite(v.duration)) setProgress(v.currentTime / v.duration); }}
            onEnded={next}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <img key={snap.id} src={snap.media_url ?? ''} alt="" className="absolute inset-0 w-full h-full object-contain" />
        )}

        {/* tap zones + hold to pause */}
        <div
          className="absolute inset-0 z-10 flex"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        >
          <button aria-label="Previous snap" onClick={prev} className="w-1/3 h-full" />
          <span className="w-1/3" />
          <button aria-label="Next snap" onClick={next} className="w-1/3 h-full" />
        </div>

        <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <div className="flex gap-1 mb-3">
            {snaps.map((s, i) => (
              <span key={s.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
                <span className="block h-full bg-white" style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <Avatar name={snap.user_name} url={author?.avatar_url} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{snap.user_name}</p>
              <p className="text-[11px] text-white/70 flex items-center gap-1">
                {snap.venue_name && <><MapPin className="w-3 h-3" />{snap.venue_name} · </>}
                {timeAgo(snap.created_at)}{timeLeft(snap.expires_at) ? ` · ${timeLeft(snap.expires_at)}` : ''}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close viewer" className="pointer-events-auto p-2 rounded-full bg-black/40"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pb-6 bg-gradient-to-t from-black/85 to-transparent" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          {snap.content && <p className="text-sm mb-3 leading-snug break-words"><EmojiText text={snap.content} /></p>}
          <div onPointerDown={(e) => e.stopPropagation()} className="relative flex items-center gap-2">
            <ReactionBar counts={counts[snap.id] ?? {}} mine={mine[snap.id] ?? null} onReact={(k) => onReact(snap.id, k)} />
            {snap.user_id && snap.user_id !== user?.id && (
              <button
                onClick={() => { const uid = snap.user_id!; const id = snap.id; onClose(); openChat(uid, { type: 'post', id }); }}
                aria-label="Message about this snap"
                className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25"
              >
                <Send className="w-4 h-4" />Reply
              </button>
            )}
          </div>
        </div>
        <div className="absolute inset-0 z-[15] pointer-events-none">
          <ReactionBurst items={bursts[snap.id] ?? []} onDone={(id) => onBurstDone(snap.id, id)} />
        </div>
      </div>
    </div>
  );
}
