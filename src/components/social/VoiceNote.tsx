import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Loader2, Mic } from 'lucide-react';
import { api } from '@/lib/apiClient';

const BARS = 32;
const SPEEDS = [1, 1.5, 2] as const;

/** m:ss */
export const formatVoiceTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Stretch / squeeze the stored bars to BARS; a note without one gets a gentle, stable pseudo-waveform. */
function resample(wave: number[] | null | undefined, seed: string): number[] {
  if (!wave || wave.length === 0) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return Array.from({ length: BARS }, (_, i) => 25 + ((h >> (i % 24)) & 0x1f) + 20 * Math.abs(Math.sin(i * 0.7)));
  }
  return Array.from({ length: BARS }, (_, i) => wave[Math.min(wave.length - 1, Math.floor((i * wave.length) / BARS))]);
}

// one voice note plays at a time, like WhatsApp
let playing: HTMLAudioElement | null = null;

/** A voice note in a chat bubble: play / pause, waveform that fills as it plays (tap to seek), time and 1x / 1.5x / 2x. */
export default function VoiceNote({ id, url, durationMs, waveform, mine, tone = 'normal' }: {
  id: string; url: string; durationMs?: number | null; waveform?: number[] | null; mine: boolean; tone?: 'normal' | 'secret';
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pos, setPos] = useState(0); // ms
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => resample(waveform, id), [waveform, id]);

  // recorded WebM often reports an Infinity duration, so the stored length wins until the file says otherwise
  const [fileMs, setFileMs] = useState<number | null>(null);
  const total = fileMs ?? durationMs ?? 0;

  // sign the private URL ahead of time so a tap can start playback straight away (iOS needs play() inside the tap)
  useEffect(() => {
    let alive = true;
    api.voiceNoteUrl(url).then((u) => alive && setSrc(u)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [url]);

  const tick = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    setPos(a.currentTime * 1000);
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const a = audio.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load?.(); }
    if (playing === a) playing = null;
  }, []);

  const ensureAudio = useCallback((source: string) => {
    if (audio.current) return audio.current;
    const a = new Audio();
    a.preload = 'auto';
    a.src = source;
    a.onloadedmetadata = () => { if (Number.isFinite(a.duration) && a.duration > 0) setFileMs(a.duration * 1000); };
    a.onplay = () => { setIsPlaying(true); raf.current = requestAnimationFrame(tick); };
    a.onpause = () => { setIsPlaying(false); if (raf.current) cancelAnimationFrame(raf.current); setPos(a.currentTime * 1000); };
    a.onended = () => { setIsPlaying(false); if (raf.current) cancelAnimationFrame(raf.current); setPos(0); a.currentTime = 0; };
    a.onerror = () => { setIsPlaying(false); setLoading(false); setFailed(true); };
    a.onwaiting = () => setLoading(true);
    a.onplaying = () => setLoading(false);
    audio.current = a;
    return a;
  }, [tick]);

  const play = useCallback(async (fromMs?: number) => {
    let source = src;
    if (!source) {
      setLoading(true);
      try { source = await api.voiceNoteUrl(url); setSrc(source); } catch { setLoading(false); setFailed(true); return; }
    }
    const a = ensureAudio(source);
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.playbackRate = speed;
    if (fromMs !== undefined) {
      // a position set before the file's metadata has loaded is ignored by some browsers
      if (a.readyState >= 1) a.currentTime = fromMs / 1000;
      else a.addEventListener('loadedmetadata', () => { a.currentTime = fromMs / 1000; }, { once: true });
    }
    setFailed(false);
    try { await a.play(); } catch { setFailed(true); } finally { setLoading(false); }
  }, [src, url, ensureAudio, speed]);

  const toggle = () => {
    const a = audio.current;
    if (a && !a.paused) a.pause(); else void play();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    if (!total) return;
    let ms: number;
    if ('key' in e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      ms = Math.max(0, Math.min(total, pos + (e.key === 'ArrowRight' ? 5000 : -5000)));
    } else {
      const box = e.currentTarget.getBoundingClientRect();
      ms = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * total;
    }
    const a = audio.current;
    if (a && !a.paused) { a.currentTime = ms / 1000; setPos(ms); } else { setPos(ms); void play(ms); }
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const progress = total ? Math.min(1, pos / total) : 0;
  const onColor = mine || tone === 'secret';
  const played = onColor ? 'bg-white' : 'bg-wa-green';
  const unplayed = onColor ? 'bg-white/40' : 'bg-wa-lightTextSecondary/40 dark:bg-wa-darkTextSecondary/40';
  const showTime = isPlaying || pos > 0 ? pos : total;

  return (
    <div className="flex items-center gap-2.5 w-60 max-w-full py-0.5" data-testid="voice-note">
      <button type="button" onClick={toggle} aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center ${onColor ? 'bg-white/20 hover:bg-white/30' : 'bg-wa-green/15 text-wa-green hover:bg-wa-green/25'}`}>
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div role="slider" tabIndex={0} aria-label="Voice message position" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(pos / 1000)} aria-valuetext={`${formatVoiceTime(pos)} of ${formatVoiceTime(total)}`}
          onClick={seek} onKeyDown={seek} className="flex items-center gap-[2px] h-7 cursor-pointer select-none">
          {bars.map((h, i) => (
            <span key={i} className={`flex-1 rounded-full transition-colors ${(i + 0.5) / bars.length <= progress ? played : unplayed}`}
              style={{ height: `${Math.max(12, h)}%` }} />
          ))}
        </div>
        <div className={`flex items-center gap-2 text-[11px] mt-0.5 ${onColor ? 'text-white/80' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'}`}>
          <span className="tabular-nums">{failed ? "Can't play this voice message" : formatVoiceTime(showTime)}</span>
          {(isPlaying || speed !== 1) && (
            <button type="button" onClick={cycleSpeed} aria-label={`Playback speed ${speed}x`}
              className={`ml-auto rounded-full px-1.5 text-[10px] font-bold ${onColor ? 'bg-white/25' : 'bg-black/10 dark:bg-white/10'}`}>{speed}×</button>
          )}
          {!isPlaying && speed === 1 && <Mic className={`ml-auto w-3.5 h-3.5 ${onColor ? '' : 'text-wa-green'}`} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
