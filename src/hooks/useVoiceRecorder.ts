import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceRecording = { blob: Blob; ext: string; durationMs: number; waveform: number[] };
export type RecorderState = 'idle' | 'starting' | 'recording';

/** Longest voice note (the database allows up to 10 minutes). */
export const MAX_VOICE_MS = 10 * 60 * 1000;
const WAVEFORM_BARS = 48;
const SAMPLE_MS = 80;

// AAC in MP4 plays everywhere (Safari, Chrome, Firefox, Android, iOS); Opus in WebM is the fallback for browsers
// that cannot record MP4 (Firefox, older Chrome)
const MIME_PREFERENCE = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function pickVoiceMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_PREFERENCE.find((t) => MediaRecorder.isTypeSupported(t));
}

export const extForMime = (mime: string) => (mime.startsWith('audio/mp4') ? 'm4a' : mime.startsWith('audio/ogg') ? 'ogg' : 'webm');

/** Squeeze the live levels into `bars` peaks, scaled so the loudest bar is 100. */
export function downsampleWaveform(levels: number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return [];
  const out: number[] = [];
  const n = Math.min(bars, levels.length);
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * levels.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
    out.push(Math.max(...levels.slice(from, to)));
  }
  const peak = Math.max(...out, 1);
  return out.map((v) => Math.max(0, Math.min(100, Math.round((v / peak) * 100))));
}

export function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Allow microphone access in your browser to record voice messages.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'Your microphone is being used by another app.';
  return 'Could not start recording. Please try again.';
}

type ActiveRecording = {
  recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; levels: number[];
  ctx?: AudioContext; timer?: number; done: Promise<Blob>;
};

/**
 * Records one voice note at a time with MediaRecorder, with a live elapsed time and input levels (for the waveform).
 * `stop()` resolves with the recording; `cancel()` throws it away. Stops by itself at MAX_VOICE_MS (onLimit).
 */
export function useVoiceRecorder({ onLimit }: { onLimit?: () => void } = {}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const rec = useRef<ActiveRecording | null>(null);
  const cancelled = useRef(false);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;

  const teardown = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    rec.current = null;
    setState('idle');
    setElapsedMs(0);
    setLevels([]);
  }, []);

  useEffect(() => () => {
    // leaving the chat mid-recording throws the recording away and releases the microphone
    const r = rec.current;
    if (r && r.recorder.state !== 'inactive') { cancelled.current = true; r.recorder.stop(); }
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    if (rec.current || state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error(window.isSecureContext === false
        ? 'Voice messages need a secure connection (https or localhost).'
        : 'This browser cannot record audio.');
    }
    setState('starting');
    cancelled.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setState('idle');
      throw new Error(micErrorMessage(e));
    }
    if (cancelled.current) { stream.getTracks().forEach((t) => t.stop()); setState('idle'); return; }

    const mime = pickVoiceMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
    });

    // live input level for the waveform (best effort: the recording works without it)
    let analyser: AnalyserNode | undefined;
    let ctx: AudioContext | undefined;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        ctx = new Ctx();
        void ctx.resume().catch(() => undefined);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
      }
    } catch { analyser = undefined; }
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;

    const r: ActiveRecording = { recorder, stream, chunks, startedAt: performance.now(), levels: [], ctx, done };
    rec.current = r;
    recorder.start(250);
    setState('recording');
    r.timer = window.setInterval(() => {
      const ms = performance.now() - r.startedAt;
      setElapsedMs(ms);
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        // RMS, lifted so speech fills the bar height
        r.levels.push(Math.min(100, Math.round(Math.sqrt(Math.sqrt(sum / buf.length)) * 140)));
        setLevels(r.levels.slice(-40));
      }
      if (ms >= MAX_VOICE_MS) onLimitRef.current?.();
    }, SAMPLE_MS);
  }, [state]);

  /** Finish and hand back the recording (null if nothing was recorded). */
  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const r = rec.current;
    if (!r) { cancelled.current = true; return null; }
    const durationMs = Math.min(MAX_VOICE_MS, performance.now() - r.startedAt);
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    const blob = await r.done;
    const waveform = downsampleWaveform(r.levels);
    teardown();
    if (blob.size === 0) return null;
    return { blob, ext: extForMime(blob.type), durationMs, waveform };
  }, [teardown]);

  const cancel = useCallback(() => {
    cancelled.current = true;
    const r = rec.current;
    if (r && r.recorder.state !== 'inactive') r.recorder.stop();
    teardown();
  }, [teardown]);

  return { state, elapsedMs, levels, start, stop, cancel };
}
