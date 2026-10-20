import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'insecure' | 'unsupported' | 'no-camera' | 'busy' | 'error';
export type Facing = 'user' | 'environment';

/**
 * Native camera access with front/back switching.
 *  - getUserMedia only works on https:// or localhost: reported as status "insecure" otherwise.
 *  - Falls back through simpler constraints (some devices reject width/height/frameRate hints).
 *  - Releases the camera when the tab is hidden, and always on unmount (privacy + battery).
 *  - Video only: the microphone is requested later, when the user first records a video.
 */
export function useCameraStream(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const seq = useRef(0);
  const facingRef = useRef<Facing>('user');
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [facing, setFacing] = useState<Facing>('user');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [multipleCameras, setMultipleCameras] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const open = useCallback(
    async (want: Facing) => {
      const id = ++seq.current;
      if (!window.isSecureContext) return setStatus('insecure');
      if (!navigator.mediaDevices?.getUserMedia) return setStatus('unsupported');
      stop();
      setStatus('starting');

      const portrait = window.innerHeight > window.innerWidth;
      const size = portrait ? { width: { ideal: 720 }, height: { ideal: 1280 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: want }, ...size, frameRate: { ideal: 30 } }, audio: false },
        { video: { facingMode: { ideal: want } }, audio: false },
        { video: true, audio: false },
      ];
      let stream: MediaStream | null = null;
      let lastErr: unknown;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (e) {
          lastErr = e;
          const n = (e as DOMException).name;
          if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'NotReadableError' || n === 'AbortError') break;
        }
      }
      if (id !== seq.current) {
        stream?.getTracks().forEach((t) => t.stop()); // a newer request superseded this one
        return;
      }
      if (!stream) {
        const n = (lastErr as DOMException | undefined)?.name;
        setStatus(
          n === 'NotAllowedError' || n === 'SecurityError' ? 'denied'
          : n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError' ? 'no-camera'
          : n === 'NotReadableError' || n === 'AbortError' ? 'busy'
          : 'error'
        );
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* autoplay is allowed for muted inline video; ignore */ }
      }
      const actual = track.getSettings().facingMode;
      const f: Facing = actual === 'user' || actual === 'environment' ? actual : want;
      facingRef.current = f;
      setFacing(f);
      setTorchSupported(!!(track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);
      navigator.mediaDevices.enumerateDevices().then((d) => setMultipleCameras(d.filter((x) => x.kind === 'videoinput').length > 1)).catch(() => undefined);
      track.addEventListener('ended', () => { if (id === seq.current) setStatus('error'); });
      setStatus('ready');
    },
    [stop]
  );

  useEffect(() => {
    if (!enabled) {
      seq.current++;
      stop();
      setStatus('idle');
      return;
    }
    open(facingRef.current);
    const onVis = () => {
      if (document.hidden) { seq.current++; stop(); setStatus('idle'); }
      else open(facingRef.current);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      // seq is a plain request counter (not a DOM ref): bumping it cancels any in-flight getUserMedia
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
      stop();
    };
  }, [enabled, open, stop]);

  const flip = useCallback(() => open(facingRef.current === 'user' ? 'environment' : 'user'), [open]);
  const retry = useCallback(() => open(facingRef.current), [open]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn((o) => !o);
    } catch { /* torch not actually available */ }
  }, [torchOn]);

  return { videoRef, status, facing, mirrored: facing === 'user', flip, retry, torchSupported, torchOn, toggleTorch, multipleCameras };
}
