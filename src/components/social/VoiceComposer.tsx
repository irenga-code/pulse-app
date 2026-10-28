import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Send, Trash2, Loader2, ChevronLeft } from 'lucide-react';
import { useVoiceRecorder, type VoiceRecording } from '@/hooks/useVoiceRecorder';
import { formatVoiceTime } from '@/components/social/VoiceNote';
import { friendlyError } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

/** Held at least this long = hold-to-talk (release sends); a quicker tap starts a hands-free recording. */
const HOLD_MS = 350;
/** Slide this far left while holding to throw the recording away. */
const CANCEL_PX = 90;
const MIN_MS = 800;

/**
 * WhatsApp-style voice notes for a chat composer. Returns the recording bar (shown in place of the text field while
 * recording) and the props for the composer's mic / send button, which must stay the same element while recording
 * so a held press keeps its pointer.
 */
export function useVoiceComposer({ disabled, secret, onSend }: {
  disabled: boolean; secret: boolean; onSend: (rec: VoiceRecording) => Promise<void>;
}) {
  const { show } = useToast();
  const [locked, setLocked] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragX, setDragX] = useState(0);
  const hold = useRef<{ start: number; x: number } | null>(null);
  const suppressClick = useRef(false);
  const finishRef = useRef<() => void>(() => undefined);
  const recorder = useVoiceRecorder({ onLimit: () => finishRef.current() });
  const stateRef = useRef(recorder.state);
  stateRef.current = recorder.state;

  const active = recorder.state !== 'idle' || sending;
  const holding = active && !locked && !sending;

  const discard = useCallback(() => {
    hold.current = null;
    setDragX(0);
    setLocked(false);
    recorder.cancel();
  }, [recorder]);

  const finish = useCallback(async () => {
    setSending(true);
    setLocked(false);
    try {
      const rec = await recorder.stop();
      if (!rec || rec.durationMs < MIN_MS) {
        show('Too short. Hold the mic to record, release to send.', 'error');
        return;
      }
      await onSend(rec);
    } catch (e) {
      console.error('[pulse] voice message failed to send', e);
      show(friendlyError(e), 'error');
    } finally {
      setSending(false);
    }
  }, [recorder, onSend, show]);
  finishRef.current = () => { void finish(); };

  const begin = useCallback(async () => {
    try {
      await recorder.start();
    } catch (e) {
      hold.current = null;
      setLocked(false);
      show(e instanceof Error ? e.message : 'Could not start recording.', 'error');
    }
  }, [recorder, show]);

  // Esc throws a recording away
  useEffect(() => {
    if (!active || sending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') discard(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, sending, discard]);

  const micProps = {
    type: 'button' as const,
    disabled: disabled || sending,
    'aria-label': sending ? 'Sending voice message' : locked ? 'Send voice message' : holding ? 'Release to send voice message' : 'Record voice message',
    title: active ? undefined : 'Hold to record, release to send. Tap to record hands-free.',
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || sending || e.button > 0 || stateRef.current !== 'idle') return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      hold.current = { start: Date.now(), x: e.clientX };
      suppressClick.current = true;
      void begin();
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!hold.current) return;
      const dx = e.clientX - hold.current.x;
      if (dx < -CANCEL_PX) discard();
      else setDragX(Math.min(0, dx));
    },
    onPointerUp: () => {
      if (!hold.current) return;
      const held = Date.now() - hold.current.start;
      hold.current = null;
      setDragX(0);
      // a quick tap, or a release while the browser was still asking for the microphone: keep recording hands-free
      if (held < HOLD_MS || stateRef.current === 'starting') setLocked(true);
      else void finish();
    },
    onPointerCancel: () => {
      if (!hold.current) return;
      hold.current = null;
      setDragX(0);
      setLocked(true);
    },
    onClick: () => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      // keyboard (Enter / Space): start hands-free, press again to send
      if (stateRef.current === 'idle' && !sending) { setLocked(true); void begin(); } else if (locked) void finish();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: 'none' } as React.CSSProperties,
  };

  const micIcon = sending ? <Loader2 className="w-5 h-5 animate-spin" /> : locked ? <Send className="w-5 h-5" /> : <Mic className="w-5 h-5" />;
  const micClass = holding
    ? 'p-2.5 rounded-full text-white bg-red-500 scale-125 shadow-lg transition-transform select-none'
    : `p-2.5 rounded-full text-white disabled:opacity-40 transition-colors select-none ${secret ? 'bg-purple-600 hover:bg-purple-500' : 'bg-wa-green hover:bg-wa-greenDark'}`;

  const muted = secret ? 'text-zinc-400' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary';
  const bar = active ? (
    <div className="flex-1 min-w-0 flex items-center gap-2 h-11 pl-1 pr-2" role="status" aria-label="Recording voice message" data-testid="voice-recording-bar">
      {locked || sending ? (
        <button type="button" onClick={discard} disabled={sending} aria-label="Delete recording"
          className={`p-2 rounded-full disabled:opacity-40 ${secret ? 'text-zinc-300 hover:bg-white/10' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-black/5 dark:hover:bg-white/10'}`}>
          <Trash2 className="w-5 h-5" />
        </button>
      ) : null}
      <span className={`w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 ${sending ? '' : 'animate-pulse'}`} aria-hidden="true" />
      <span className="text-sm font-medium tabular-nums" aria-live="off">{formatVoiceTime(recorder.elapsedMs)}</span>
      {sending ? (
        <span className={`text-xs ${muted}`}>Sending…</span>
      ) : locked ? (
        <span className="flex-1 min-w-0 flex items-center justify-end gap-[2px] h-6 overflow-hidden" aria-hidden="true">
          {recorder.levels.map((l, i) => <span key={i} className="w-[3px] flex-shrink-0 rounded-full bg-red-500/80" style={{ height: `${Math.max(10, l)}%` }} />)}
        </span>
      ) : (
        <span className={`flex-1 min-w-0 flex items-center justify-center gap-1 text-xs ${muted}`} style={{ transform: `translateX(${dragX}px)`, opacity: 1 + dragX / (CANCEL_PX * 1.5) }}>
          <ChevronLeft className="w-4 h-4" />Slide to cancel
        </span>
      )}
    </div>
  ) : null;

  // recording right now (not while the finished note uploads): drives the live "recording audio…" status
  const recording = recorder.state !== 'idle';
  return { active, recording, bar, micProps, micIcon, micClass };
}
