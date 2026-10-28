import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, SwitchCamera, Zap, ZapOff, Timer, Wand2, Sparkles, Type, Pencil, Sticker, MapPin, ImagePlus, RotateCcw, Loader2, CameraOff,
} from 'lucide-react';
import CameraStage, { type StageHandle } from '@/camera/CameraStage';
import ShutterButton from '@/camera/ShutterButton';
import { DrawBar, EffectStrip, FilterStrip, StickerTray, TextEditor } from '@/camera/CameraTools';
import PostBar from '@/camera/PostBar';
import SendToSheet from '@/camera/SendToSheet';
import { useCameraStream } from '@/camera/useCameraStream';
import { useCanvasRecorder, type RecordResult } from '@/camera/useCanvasRecorder';
import { useGeolocation } from '@/camera/useGeolocation';
import { useSnapDispatch, destinationKey, destinationLabel, type SnapDestination } from '@/camera/useSnapDispatch';
import { drawScene } from '@/camera/renderer';
import { MAX_VIDEO_MS, STAGE_H, STAGE_W, type StickerDef } from '@/camera/constants';
import { EMPTY_SCENE, type CaptureResult, type Scene, type TextItem } from '@/camera/types';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/apiClient';
import { revalidateAll } from '@/lib/cache';
import type { NewPostInput, Post, SnapMeta } from '@/lib/types';
import { lockBodyScroll } from '@/lib/scrollLock';

type Mode = 'capture' | 'edit' | 'review';
type Panel = null | 'filters' | 'effects' | 'stickers' | 'sendto';
type VideoClip = { blob: Blob; url: string; ext: 'mp4' | 'webm'; durationMs: number; width: number; height: number; meta: SnapMeta };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
let idCounter = 0;
const uid = () => `o${Date.now().toString(36)}${idCounter++}`;

const railBtn = 'w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40';
const clock = (ms: number) => `0:${String(Math.min(99, Math.floor(ms / 1000))).padStart(2, '0')}`;

/**
 * Read a clip's real size/duration. `ok` is false only on definite evidence that there is no usable picture
 * (metadata loaded with a 0x0 size, or a decode error). A slow device is NOT evidence of a bad file: on a
 * timeout the clip is accepted with the stage size.
 */
function probeVideo(url: string) {
  return new Promise<{ ok: boolean; width: number; height: number; durationMs: number }>((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    let settled = false;
    const finish = (ok: boolean, timedOut = false) => {
      if (settled) return;
      settled = true;
      resolve({
        ok,
        width: timedOut || !v.videoWidth ? STAGE_W : v.videoWidth,
        height: timedOut || !v.videoHeight ? STAGE_H : v.videoHeight,
        durationMs: Number.isFinite(v.duration) ? v.duration * 1000 : 0,
      });
    };
    v.onloadedmetadata = () => finish(v.videoWidth > 0 && v.videoHeight > 0);
    v.onerror = () => finish(false);
    window.setTimeout(() => finish(true, true), 20_000);
    v.src = url;
  });
}

/** Without a feed hook (Quick-Snap from the header or a chat), feed snaps go straight to the API. */
const createPostDirect = async (input: NewPostInput) => {
  const post = await api.createPost(input);
  revalidateAll();
  return post;
};

/**
 * Full-screen camera (Quick-Snap). Flow: capture (tap = photo, hold = video, up to 15 s) -> edit (text, drawing,
 * stickers, filters, effects, location tag) -> caption -> Send to: status, Pulse feed,
 * your channels and chats (upload once, deliver everywhere). With `destination` (a chat's camera button) the
 * snap goes straight there.
 */
export default function CameraModal({ onClose, savePost = createPostDirect, destination, defaultDestinations, onSent }: {
  onClose: () => void;
  savePost?: (input: NewPostInput) => Promise<Post>;
  /** Locked destination: skip the Send to sheet. */
  destination?: SnapDestination;
  /** Pre-ticked in the Send to sheet (default: My status). */
  defaultDestinations?: SnapDestination[];
  onSent?: (sent: SnapDestination[]) => void;
}) {
  const { show } = useToast();
  const geo = useGeolocation();
  const recorder = useCanvasRecorder();
  const publisher = useSnapDispatch(savePost);
  // the Send to sheet re-opens with only the failed destinations ticked
  const [sendTo, setSendTo] = useState<SnapDestination[]>(() => defaultDestinations ?? [{ kind: 'status' }]);

  const [mode, setMode] = useState<Mode>('capture');
  const [fromGallery, setFromGallery] = useState(false);
  const cam = useCameraStream(mode === 'capture' && !fromGallery);
  const stageRef = useRef<StageHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [scene, setSceneState] = useState<Scene>(EMPTY_SCENE);
  const [frozen, setFrozen] = useState<HTMLCanvasElement | null>(null);
  const [clip, setClip] = useState<VideoClip | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [brush, setBrush] = useState({ color: '#ff2bd6', width: 14 });
  const [textEditing, setTextEditing] = useState<{ item?: TextItem } | null>(null);
  const [geoOn, setGeoOn] = useState(false);
  const [caption, setCaption] = useState('');
  const [timer, setTimer] = useState<0 | 3>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const micRef = useRef<MediaStream | null>(null);
  const wantRecording = useRef(false);
  const captureRef = useRef<CaptureResult | null>(null);

  const editable = mode !== 'review';

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3500);
  }, []);

  const setScene = useCallback((updater: (s: Scene) => Scene) => {
    captureRef.current = null; // any edit invalidates a previously exported image
    setSceneState(updater);
  }, []);

  const stageScene = useMemo<Scene>(
    () => ({
      ...scene,
      geoLabel: geoOn ? geo.info?.label ?? null : null,
    }),
    [scene, geoOn, geo.info]
  );

  const buildMeta = useCallback((): SnapMeta => {
    const meta: SnapMeta = {};
    if (scene.filter !== 'none') meta.filter = scene.filter;
    if (scene.effect !== 'none') meta.effect = scene.effect;
    if (stageScene.geoLabel) meta.geo = stageScene.geoLabel;
    const tools: string[] = [];
    if (scene.items.some((i) => i.type === 'text')) tools.push('text');
    if (scene.items.some((i) => i.type === 'sticker')) tools.push('sticker');
    if (scene.strokes.length) tools.push('draw');
    if (tools.length) meta.tools = tools;
    return meta;
  }, [scene, stageScene]);

  // ---- housekeeping ---------------------------------------------------------
  useEffect(() => {
    const unlock = lockBodyScroll();
    return () => {
      unlock();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const hasWork = mode !== 'capture' || scene.items.length > 0 || scene.strokes.length > 0;
  const requestClose = useCallback(() => {
    if (publisher.state === 'uploading' || publisher.state === 'saving') return;
    if (hasWork) setConfirmClose(true);
    else onClose();
  }, [hasWork, onClose, publisher.state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (textEditing) setTextEditing(null);
      else if (panel) setPanel(null);
      else if (tool === 'draw') setTool('select');
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textEditing, panel, tool, requestClose]);

  // ---- capture --------------------------------------------------------------
  const takePhoto = useCallback(() => {
    const frame = stageRef.current?.takeFrame();
    if (!frame) return flash('Camera is not ready yet');
    setFrozen(frame);
    setMode('edit');
    setPanel(null);
  }, [flash]);

  const onShutterPhoto = useCallback(() => {
    if (timer === 0) return takePhoto();
    let n: number = timer;
    setCountdown(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) { setCountdown(null); takePhoto(); }
      else { setCountdown(n); window.setTimeout(tick, 1000); }
    };
    window.setTimeout(tick, 1000);
  }, [timer, takePhoto]);

  const getMic = useCallback(async () => {
    if (micRef.current?.active) return micRef.current;
    try {
      micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      micRef.current = null;
      flash('Microphone blocked: recording without sound');
    }
    return micRef.current;
  }, [flash]);

  const onRecordStart = useCallback(async () => {
    const canvas = stageRef.current?.getCanvas();
    if (!canvas || !recorder.supported) return;
    wantRecording.current = true;
    setPanel(null);
    const audio = await getMic();
    if (!wantRecording.current) return; // finger lifted while the mic prompt was open
    const meta = buildMeta();
    recorder
      .start(canvas, audio)
      .then(async (res: RecordResult | null) => {
        if (!res) return flash('Nothing was recorded');
        const url = URL.createObjectURL(res.blob);
        // Never trust the encoder: confirm the file really has a picture before offering to post it.
        const info = await probeVideo(url);
        if (!info.ok) {
          URL.revokeObjectURL(url);
          recorder.markBroken(res.mime);
          return flash('That recording had no picture, so it was discarded. Please try again.');
        }
        setClip({ blob: res.blob, url, ext: res.ext, durationMs: res.durationMs, width: info.width, height: info.height, meta });
        setMode('review');
      })
      .catch((e: Error) => flash(e.message));
  }, [recorder, getMic, buildMeta, flash]);

  const onRecordStop = useCallback(() => {
    wantRecording.current = false;
    recorder.stop();
  }, [recorder]);

  const resetAll = useCallback(() => {
    setMode('capture');
    setFrozen(null);
    setClip(null);
    setSceneState(EMPTY_SCENE);
    setPanel(null);
    setTool('select');
    setCaption('');
    captureRef.current = null;
    publisher.reset();
  }, [publisher]);

  // ---- import from gallery (also the fallback when there is no camera, e.g. desktop / WSL) ----
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = STAGE_W;
        c.height = STAGE_H;
        drawScene(c.getContext('2d')!, { image: img, width: img.naturalWidth, height: img.naturalHeight, mirror: false }, EMPTY_SCENE, 0);
        setFromGallery(true);
        setFrozen(c);
        setMode('edit');
      } catch {
        flash('That image could not be opened');
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (/^video\/(mp4|webm|quicktime)$/.test(f.type)) {
      if (f.size > MAX_UPLOAD_BYTES) return flash('That video is too large (max 25 MB)');
      const url = URL.createObjectURL(f);
      const info = await probeVideo(url);
      if (!info.ok) { URL.revokeObjectURL(url); return flash('That video could not be opened in this browser'); }
      if (info.durationMs > MAX_VIDEO_MS + 500) { URL.revokeObjectURL(url); return flash('Videos can be up to 15 seconds'); }
      setFromGallery(true);
      setClip({ blob: f, url, ext: f.type === 'video/webm' ? 'webm' : 'mp4', durationMs: info.durationMs, width: info.width, height: info.height, meta: {} });
      setMode('review');
    } else {
      flash('Choose a photo or a short video');
    }
  };

  // ---- overlay tools ----------------------------------------------------------
  const addSticker = (s: StickerDef) => {
    setScene((sc) => ({ ...sc, items: [...sc.items, { id: uid(), type: 'sticker', value: s.value, badge: s.badge, x: 0.5, y: 0.42, scale: 1, rotation: 0 }] }));
    setPanel(null);
  };
  const saveText = (v: { text: string; style: TextItem['style']; color: string }) => {
    const editing = textEditing?.item;
    setScene((sc) => ({
      ...sc,
      items: editing
        ? sc.items.map((i) => (i.id === editing.id ? ({ ...i, ...v } as TextItem) : i))
        : [...sc.items, { id: uid(), type: 'text', ...v, x: 0.5, y: 0.4, scale: 1, rotation: 0 }],
    }));
    setTextEditing(null);
  };
  const toggleGeo = async () => {
    if (geoOn) return setGeoOn(false);
    const g = geo.info ?? (await geo.request());
    if (g?.label) setGeoOn(true);
    else flash('Location unavailable: allow location access to add a tag');
  };

  // ---- publish ----------------------------------------------------------------
  const send = async (destinations: SnapDestination[]) => {
    let capture = captureRef.current;
    if (!capture) {
      if (mode === 'edit') {
        const blob = await stageRef.current!.exportImage();
        capture = { kind: 'image', blob, ext: 'jpg', width: STAGE_W, height: STAGE_H, previewUrl: '', meta: buildMeta() };
      } else if (clip) {
        capture = { kind: 'video', blob: clip.blob, ext: clip.ext, width: clip.width, height: clip.height, durationMs: clip.durationMs, previewUrl: clip.url, meta: clip.meta };
      } else return;
      captureRef.current = capture;
    }
    const result = await publisher.dispatch(capture, destinations, { caption });
    if (!result) return;
    if (result.sent.length > 0) onSent?.(result.sent);
    if (result.failed.length === 0) {
      show(destinations.length === 1 ? `Sent to ${destinationLabel(destinations[0])}` : `Sent to ${destinations.length} places`);
      onClose();
    } else {
      setSendTo(result.failed.map((f) => f.destination));
      if (!destination) setPanel('sendto');
    }
  };
  const post = () => (destination ? send([destination]) : setPanel('sendto'));

  // ---- render -----------------------------------------------------------------
  const camBlocked = mode === 'capture' && !fromGallery && cam.status !== 'ready';
  const blockedMsg: Record<string, string> = {
    denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.',
    insecure: 'The camera needs a secure connection. Open Pulse on localhost or over https (run npm run dev:https for phone testing).',
    unsupported: 'This browser does not support camera access.',
    'no-camera': 'No camera was found on this device.',
    busy: 'Another app is using the camera. Close it and try again.',
    error: 'The camera stopped unexpectedly.',
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Camera" className="fixed inset-0 z-[70] bg-black flex items-center justify-center text-white">
      <div className="relative w-full mx-auto overflow-hidden bg-black" style={{ height: '100dvh', maxWidth: 'calc(100dvh * 9 / 16)' }}>
        {/* off-screen (not display:none) so browsers keep decoding frames */}
        <video ref={cam.videoRef} playsInline muted autoPlay className="absolute w-px h-px opacity-0 pointer-events-none" aria-hidden="true" />

        <div className="absolute inset-0">
          <CameraStage
            ref={stageRef}
            videoRef={cam.videoRef}
            mirror={cam.mirrored}
            frozen={frozen}
            scene={stageScene}
            onScene={setScene}
            tool={tool}
            brush={brush}
            interactive={editable}
            paused={mode === 'review'}
            onEditText={(item) => setTextEditing({ item })}
          />
        </div>

        {mode === 'review' && clip && (
          <video key={clip.url} src={clip.url} autoPlay loop muted playsInline controls className="absolute inset-0 w-full h-full object-contain bg-black" data-testid="review-video" />
        )}

        {/* camera problems / loading */}
        {camBlocked && (
          <div className="absolute inset-0 z-10 bg-black/85 flex flex-col items-center justify-center text-center px-8 gap-3">
            {cam.status === 'starting' || cam.status === 'idle' ? (
              <><Loader2 className="w-8 h-8 animate-spin text-wa-green" /><p className="text-sm">Starting camera…</p></>
            ) : (
              <>
                <CameraOff className="w-10 h-10 text-white/60" />
                <p className="text-sm max-w-xs">{blockedMsg[cam.status] ?? blockedMsg.error}</p>
                {(cam.status === 'denied' || cam.status === 'busy' || cam.status === 'error') && (
                  <button onClick={cam.retry} className="rounded-full bg-wa-green px-5 py-2 text-sm font-semibold">Try again</button>
                )}
              </>
            )}
            <button onClick={() => fileRef.current?.click()} className="rounded-full bg-white/15 px-5 py-2 text-sm font-semibold flex items-center gap-2">
              <ImagePlus className="w-4 h-4" />Choose a photo or video
            </button>
          </div>
        )}

        {countdown !== null && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none text-8xl font-extrabold drop-shadow-lg" aria-live="assertive">{countdown}</div>
        )}

        {/* top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <button onClick={requestClose} aria-label="Close camera" className={railBtn}><X className="w-5 h-5" /></button>
          {recorder.recording && (
            <div className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-sm font-semibold" role="timer">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />{clock(recorder.elapsedMs)} / {clock(MAX_VIDEO_MS)}
            </div>
          )}
          {mode === 'capture' && !recorder.recording && cam.torchSupported && (
            <button onClick={cam.toggleTorch} aria-label="Flash" aria-pressed={cam.torchOn} className={railBtn}>{cam.torchOn ? <Zap className="w-5 h-5 text-yellow-300" /> : <ZapOff className="w-5 h-5" />}</button>
          )}
          {mode !== 'capture' && (
            <button onClick={resetAll} aria-label="Retake" className={`${railBtn} !w-auto px-3.5 gap-1.5 text-sm font-semibold`}><RotateCcw className="w-4 h-4" />Retake</button>
          )}
        </div>

        {notice && (
          <div role="status" className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-[85%] rounded-full bg-black/75 px-4 py-2 text-xs text-center">{notice}</div>
        )}

        {/* tool rail */}
        {!recorder.recording && tool === 'select' && !camBlocked && (
          <div className="absolute right-3 top-20 z-20 flex flex-col gap-2.5">
            {mode === 'capture' && cam.multipleCameras && <button onClick={cam.flip} aria-label="Flip camera" className={railBtn}><SwitchCamera className="w-5 h-5" /></button>}
            {mode === 'capture' && <button onClick={() => setTimer((t) => (t === 0 ? 3 : 0))} aria-label="Timer" aria-pressed={timer === 3} className={`${railBtn} ${timer ? '!bg-wa-green' : ''}`}><Timer className="w-5 h-5" /></button>}
            {editable && (
              <>
                <button onClick={() => setTextEditing({})} aria-label="Add text" className={railBtn}><Type className="w-5 h-5" /></button>
                <button onClick={() => { setTool('draw'); setPanel(null); }} aria-label="Draw" className={railBtn}><Pencil className="w-5 h-5" /></button>
                <button onClick={() => setPanel('stickers')} aria-label="Stickers" className={railBtn}><Sticker className="w-5 h-5" /></button>
                <button onClick={() => setPanel('filters')} aria-label="Filters" className={`${railBtn} ${scene.filter !== 'none' ? '!bg-wa-green' : ''}`}><Wand2 className="w-5 h-5" /></button>
                <button onClick={() => setPanel('effects')} aria-label="Effects" className={`${railBtn} ${scene.effect !== 'none' ? '!bg-wa-green' : ''}`}><Sparkles className="w-5 h-5" /></button>
                <button onClick={toggleGeo} aria-label="Location tag" aria-pressed={geoOn} className={`${railBtn} ${geoOn ? '!bg-wa-green' : ''}`}>{geo.status === 'asking' ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}</button>
              </>
            )}
          </div>
        )}

        {/* shutter row */}
        {mode === 'capture' && !camBlocked && !panel && tool === 'select' && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center pb-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <button onClick={() => fileRef.current?.click()} aria-label="Choose from gallery" className={`${railBtn} absolute left-6`}><ImagePlus className="w-5 h-5" /></button>
            <ShutterButton
              onPhoto={onShutterPhoto}
              onRecordStart={onRecordStart}
              onRecordStop={onRecordStop}
              recording={recorder.recording}
              progress={recorder.progress}
              videoSupported={recorder.supported}
              disabled={countdown !== null}
            />
          </div>
        )}
        {mode === 'capture' && !recorder.recording && !camBlocked && !panel && tool === 'select' && recorder.supported && (
          <p className="absolute bottom-[7.2rem] left-0 right-0 z-10 text-center text-[11px] text-white/70 pointer-events-none">Tap for photo · hold for video</p>
        )}

        {/* publishing bar */}
        {mode !== 'capture' && tool === 'select' && !panel && (
          <PostBar
            caption={caption}
            onCaption={setCaption}
            onPost={post}
            postLabel={destination ? `Send to ${destinationLabel(destination)}` : 'Send to…'}
            state={publisher.state}
            error={publisher.error}
          />
        )}

        {/* panels */}
        {panel === 'filters' && <FilterStrip value={scene.filter} onChange={(f) => setScene((s) => ({ ...s, filter: f }))} onClose={() => setPanel(null)} />}
        {panel === 'effects' && <EffectStrip value={scene.effect} onChange={(f) => setScene((s) => ({ ...s, effect: f }))} onClose={() => setPanel(null)} />}
        {panel === 'stickers' && <StickerTray onPick={addSticker} onClose={() => setPanel(null)} />}
        {panel === 'sendto' && (
          <SendToSheet
            key={sendTo.map(destinationKey).join()}
            initial={sendTo}
            busy={publisher.busy}
            onSend={(list) => { setSendTo(list); void send(list); }}
            onClose={() => setPanel(null)}
          />
        )}
        {tool === 'draw' && (
          <DrawBar
            color={brush.color}
            width={brush.width}
            onColor={(color) => setBrush((b) => ({ ...b, color }))}
            onWidth={(width) => setBrush((b) => ({ ...b, width }))}
            canUndo={scene.strokes.length > 0}
            onUndo={() => setScene((s) => ({ ...s, strokes: s.strokes.slice(0, -1) }))}
            onClear={() => setScene((s) => ({ ...s, strokes: [] }))}
            onDone={() => setTool('select')}
          />
        )}
        {textEditing && <TextEditor initial={textEditing.item} onDone={saveText} onCancel={() => setTextEditing(null)} />}

        {confirmClose && (
          <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center p-6" role="alertdialog" aria-label="Discard snap?">
            <div className="rounded-2xl bg-wa-darkPanel border border-wa-darkBorder p-5 w-full max-w-xs text-center">
              <p className="font-semibold">Discard this snap?</p>
              <p className="text-xs text-white/60 mt-1">Your edits will be lost.</p>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setConfirmClose(false)} className="flex-1 rounded-xl border border-white/25 py-2.5 text-sm font-medium">Keep editing</button>
                <button onClick={onClose} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold">Discard</button>
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" onChange={onFile} className="hidden" aria-label="Choose a photo or video" />
      </div>
    </div>
  );
}
