import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_VIDEO_MS, VIDEO_BITS_PER_SECOND } from '@/camera/constants';
import { pickRecorderMime } from '@/camera/mime';

export type RecordResult = { blob: Blob; durationMs: number; mime: string; ext: 'mp4' | 'webm' };

/**
 * Records the stage canvas (so filters, effects, stickers and drawings are burned into the video) plus
 * optional microphone audio. Auto-stops at MAX_VIDEO_MS. start() resolves when the recording finishes,
 * whether stop() was called or the limit hit.
 */
export function useCanvasRecorder() {
  /** Formats that produced unplayable (e.g. audio-only) files in this browser: skipped from then on. */
  const [broken, setBroken] = useState<string[]>([]);
  const format = useMemo(() => pickRecorderMime(undefined, broken), [broken]);
  const supported = !!format && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const start = useCallback(
    (canvas: HTMLCanvasElement, audio: MediaStream | null) =>
      new Promise<RecordResult | null>((resolve, reject) => {
        if (!supported || !format) return reject(new Error('Video recording is not supported in this browser'));
        try {
          // Push frames ourselves (captureStream(0) + requestFrame at 30 fps). With captureStream(30) the browser only
          // captures when its compositor repaints the canvas, which can stall on a busy page and record nothing.
          let stream = canvas.captureStream(0);
          let pushTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
          if (typeof pushTrack?.requestFrame !== 'function') {
            stream.getTracks().forEach((t) => t.stop());
            stream = canvas.captureStream(30); // older browsers: let the browser time the frames
            pushTrack = undefined;
          }
          const frameTimer = pushTrack ? window.setInterval(() => pushTrack!.requestFrame!(), 1000 / 30) : undefined;
          audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
          const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
          const chunks: Blob[] = [];
          const startedAt = Date.now();
          rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          rec.onerror = () => { window.clearInterval(timerRef.current); window.clearInterval(frameTimer); setRecording(false); reject(new Error('Recording failed')); };
          rec.onstop = () => {
            window.clearInterval(timerRef.current);
            window.clearInterval(frameTimer);
            stream.getVideoTracks().forEach((t) => t.stop()); // the mic stream is owned by the caller
            setRecording(false);
            recRef.current = null;
            const blob = new Blob(chunks, { type: format.mime.split(';')[0] }); // plain type, no codec list
            resolve(blob.size ? { blob, durationMs: Date.now() - startedAt, mime: format.mime, ext: format.ext } : null);
          };
          rec.start(250);
          recRef.current = rec;
          setRecording(true);
          setElapsedMs(0);
          timerRef.current = window.setInterval(() => {
            const ms = Date.now() - startedAt;
            setElapsedMs(ms);
            if (ms >= MAX_VIDEO_MS && rec.state === 'recording') rec.stop();
          }, 100);
        } catch (e) {
          reject(e as Error);
        }
      }),
    [supported, format]
  );

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state === 'recording') rec.stop();
  }, []);

  useEffect(() => () => { window.clearInterval(timerRef.current); if (recRef.current?.state === 'recording') recRef.current.stop(); }, []);

  const markBroken = useCallback((mime: string) => setBroken((b) => (b.includes(mime) ? b : [...b, mime])), []);

  return { supported, recording, elapsedMs, progress: Math.min(1, elapsedMs / MAX_VIDEO_MS), start, stop, markBroken };
}
