import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Eye, Trash2, Flag, Send, MessageCircle, Loader2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { useEmojiInsert } from '@/components/emoji/useEmojiInsert';
import ReportModal from '@/components/community/ReportModal';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { timeAgo, timeLeft } from '@/lib/time';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import type { StatusGroup } from '@/hooks/useStatuses';
import type { PublicProfile, Status } from '@/lib/types';

export const STATUS_IMAGE_MS = 5000;
const HOLD_MS = 180;
const TICK_MS = 50;

type Props = {
  groups: StatusGroup[];
  startGroup: number;
  authors: Record<string, PublicProfile>;
  venueNames: Record<string, string>;
  onViewed: (s: Status) => void;
  /** called after the owner deletes a status, so the tray can refresh */
  onChanged: () => void;
  onClose: () => void;
};

/**
 * Full-screen status viewer.
 *  - progress bars on top, photos play for 5 s, videos play through
 *  - tap the right side = next, left side = previous
 *  - press and hold anywhere = pause (release to continue)
 *  - typing a reply, opening the viewer list or a dialog also pauses
 */
export default function StatusViewerModal({ groups, startGroup, authors, venueNames, onViewed, onChanged, onClose }: Props) {
  const { user } = useAuth();
  const { show } = useToast();
  const { openChat } = useSocial();
  const [gi, setGi] = useState(Math.min(Math.max(0, startGroup), Math.max(0, groups.length - 1)));
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [panel, setPanel] = useState<null | 'viewers' | 'report' | 'delete'>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<{ viewer_id: string; viewed_at: string }[]>([]);
  const [viewerPeople, setViewerPeople] = useState<Record<string, PublicProfile>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);
  const elapsed = useRef(0);
  const holdTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const insert = useEmojiInsert(replyRef, reply, setReply, 500);

  const group = groups[gi];
  const status: Status | undefined = group?.items[Math.min(si, (group?.items.length ?? 1) - 1)];
  const mine = !!user && status?.user_id === user.id;
  const paused = holding || typing || panel !== null;
  const author = status ? authors[status.user_id] : undefined;

  const goNext = useCallback(() => {
    const g = groups[gi];
    if (!g) return onClose();
    if (si < g.items.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) { setGi(gi + 1); setSi(0); }
    else onClose();
  }, [groups, gi, si, onClose]);

  const goPrev = useCallback(() => {
    if (si > 0) setSi(si - 1);
    else if (gi > 0) { setGi(gi - 1); setSi(groups[gi - 1].items.length - 1); }
    else { elapsed.current = 0; setProgress(0); if (videoRef.current) videoRef.current.currentTime = 0; }
  }, [gi, si, groups]);

  const nextRef = useRef(goNext);
  nextRef.current = goNext;

  // everything vanished (expired / deleted) while watching
  useEffect(() => { if (!status) onClose(); }, [status, onClose]);

  // new status: restart the clock and record the view
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
    setPanel(null);
    if (status) onViewed(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.id]);

  // photo timer (pausable)
  useEffect(() => {
    if (!status || status.media_type === 'video' || paused) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const t = Date.now();
      elapsed.current += Math.min(t - last, 250); // a background tab must not skip several statuses at once
      last = t;
      const p = elapsed.current / STATUS_IMAGE_MS;
      if (p >= 1) { window.clearInterval(id); nextRef.current(); } else setProgress(p);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [status?.id, status?.media_type, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // video pause / resume
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => undefined);
  }, [paused, status?.id]);

  // owner: who has seen this status
  useEffect(() => {
    setViewers([]);
    if (!status || !mine) return;
    let alive = true;
    api.statusViewers(status.id)
      .then(async (rows) => {
        const people = await api.profilesByIds(rows.map((r) => r.viewer_id));
        if (alive) { setViewers(rows); setViewerPeople(people); }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [status?.id, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard + page scroll lock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // typing a reply
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === ' ') { e.preventDefault(); setHolding((h) => !h); }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; window.clearTimeout(holdTimer.current); };
  }, [goNext, goPrev, onClose]);

  const onDown = () => {
    held.current = false;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => { held.current = true; setHolding(true); }, HOLD_MS);
  };
  const endHold = () => {
    window.clearTimeout(holdTimer.current);
    if (held.current) { held.current = false; setHolding(false); return true; }
    return false;
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (endHold()) return; // it was a hold, not a tap
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.width ? (e.clientX - r.left) / r.width : 1;
    if (x < 0.3) goPrev(); else goNext();
  };

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body || !status || sending) return;
    setSending(true);
    try {
      const convId = await api.startConversation(status.user_id);
      await api.sendMessage(convId, body, { type: 'status', id: status.id });
      setReply('');
      show('Reply sent');
    } catch (err) {
      show(friendlyError(err), 'error');
    }
    setSending(false);
  };

  const remove = async () => {
    if (!status) return;
    try {
      await api.deleteStatus(status.id);
      show('Status deleted');
      onChanged();
      setPanel(null);
    } catch (err) {
      show(friendlyError(err), 'error');
    }
  };

  const bars = useMemo(() => group?.items ?? [], [group]);
  if (!status || !group) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Status viewer" className="fixed inset-0 z-[49] bg-black flex items-center justify-center text-white select-none">
      <div className="relative w-full mx-auto bg-black overflow-hidden" style={{ height: '100dvh', maxWidth: 'calc(100dvh * 9 / 16)' }}>
        {status.media_type === 'video' ? (
          <video
            ref={videoRef}
            key={status.id}
            src={status.media_url}
            autoPlay
            playsInline
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration > 0 && Number.isFinite(v.duration)) setProgress(v.currentTime / v.duration); }}
            onEnded={goNext}
            onError={goNext}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <img key={status.id} src={status.media_url} alt="" draggable={false} onError={goNext} className="absolute inset-0 w-full h-full object-contain" />
        )}

        {/* tap to skip, hold to pause */}
        <div
          data-testid="status-gesture"
          className="absolute inset-0 z-10 touch-none"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
        />

        <div className="absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <div className="flex gap-1 mb-3" aria-hidden="true">
            {bars.map((s, i) => (
              <span key={s.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
                <span data-testid="status-progress" className="block h-full bg-white" style={{ width: `${(i < si ? 1 : i === si ? progress : 0) * 100}%` }} />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <Avatar name={author?.display_name ?? '?'} url={author?.avatar_url} size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{mine ? 'Your status' : author?.display_name ?? 'Pulse user'}</p>
              <p className="text-[11px] text-white/70 flex items-center gap-1">
                {status.venue_id && venueNames[status.venue_id] && <><MapPin className="w-3 h-3" />{venueNames[status.venue_id]} · </>}
                {timeAgo(status.created_at)}{timeLeft(status.expires_at) ? ` · ${timeLeft(status.expires_at)}` : ''}
              </p>
            </div>
            {mine ? (
              <button onClick={() => setPanel('delete')} aria-label="Delete status" className="pointer-events-auto p-2 rounded-full bg-black/40"><Trash2 className="w-5 h-5" /></button>
            ) : (
              <button onClick={() => (user ? setPanel('report') : undefined)} aria-label="Report status" className="pointer-events-auto p-2 rounded-full bg-black/40"><Flag className="w-5 h-5" /></button>
            )}
            <button onClick={onClose} aria-label="Close status viewer" className="pointer-events-auto p-2 rounded-full bg-black/40"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/85 to-transparent" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {status.caption && <p className="text-sm mb-3 leading-snug break-words"><EmojiText text={status.caption} /></p>}
          {mine ? (
            <button onClick={() => setPanel(panel === 'viewers' ? null : 'viewers')} aria-label={`${viewers.length} views`} className="flex items-center gap-1.5 text-sm text-white/90">
              <Eye className="w-4 h-4" />{viewers.length} {viewers.length === 1 ? 'view' : 'views'}
            </button>
          ) : (
            <form onSubmit={sendReply} className="flex items-center gap-1">
              <input
                ref={replyRef}
                value={reply}
                onChange={(e) => setReply(e.target.value.slice(0, 500))}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                placeholder={user ? 'Reply to this status…' : 'Sign in to reply'}
                disabled={!user}
                aria-label="Reply to status"
                className="flex-1 min-w-0 rounded-full px-4 py-2.5 text-sm bg-white/15 border border-white/30 placeholder:text-white/60 text-white focus:outline-none focus:border-white"
              />
              <EmojiButton label="Add emoji to reply" onPick={insert} />
              <button type="submit" disabled={!reply.trim() || sending} aria-label="Send reply" className="p-2.5 rounded-full bg-wa-green disabled:opacity-40">
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
              <button type="button" onClick={() => { const uid = status.user_id; const id = status.id; onClose(); openChat(uid, { type: 'status', id }); }} aria-label="Open chat" className="p-2.5 rounded-full bg-white/15">
                <MessageCircle className="w-5 h-5" />
              </button>
            </form>
          )}
        </div>

        {panel === 'viewers' && (
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[55%] overflow-y-auto rounded-t-3xl bg-zinc-900 p-4" role="region" aria-label="Viewers">
            <div className="flex items-center mb-2"><h3 className="text-sm font-semibold flex-1">Seen by {viewers.length}</h3><button onClick={() => setPanel(null)} aria-label="Close viewers"><X className="w-5 h-5" /></button></div>
            {viewers.length === 0 ? <p className="text-xs text-white/60 py-3">No views yet.</p> : (
              <ul className="space-y-2">
                {viewers.map((v) => (
                  <li key={v.viewer_id} className="flex items-center gap-2.5">
                    <Avatar name={viewerPeople[v.viewer_id]?.display_name ?? '?'} url={viewerPeople[v.viewer_id]?.avatar_url} size={32} />
                    <span className="text-sm flex-1 truncate">{viewerPeople[v.viewer_id]?.display_name ?? 'Pulse user'}</span>
                    <span className="text-[11px] text-white/60">{timeAgo(v.viewed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {panel === 'delete' && (
          <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center p-6" role="alertdialog" aria-label="Delete status?">
            <div className="rounded-2xl bg-zinc-900 p-5 w-full max-w-xs text-center">
              <p className="text-sm font-semibold mb-4">Delete this status?</p>
              <div className="flex gap-2">
                <button onClick={remove} className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-wa-live">Delete</button>
                <button onClick={() => setPanel(null)} className="flex-1 rounded-xl py-2.5 text-sm font-medium bg-white/10">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {panel === 'report' && <ReportModal targetType="status" targetId={status.id} onClose={() => setPanel(null)} />}
    </div>,
    document.body
  );
}
