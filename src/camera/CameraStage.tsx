import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Trash2 } from 'lucide-react';
import { PHOTO_QUALITY, STAGE_H, STAGE_W } from '@/camera/constants';
import { drawScene, hitTest, type Source } from '@/camera/renderer';
import { EMPTY_SCENE, type OverlayItem, type Scene, type Stroke, type TextItem } from '@/camera/types';

export type StageHandle = {
  getCanvas: () => HTMLCanvasElement;
  /** Raw camera frame (cover-cropped, mirrored like the preview) with no filter or overlays. */
  takeFrame: () => HTMLCanvasElement | null;
  exportImage: () => Promise<Blob>;
};

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  mirror: boolean;
  /** Frozen photo being edited; null = live camera. */
  frozen: HTMLCanvasElement | null;
  scene: Scene;
  onScene: (updater: (s: Scene) => Scene) => void;
  tool: 'select' | 'draw';
  brush: { color: string; width: number };
  /** Allow moving/pinching/deleting overlays and drawing. */
  interactive: boolean;
  paused?: boolean;
  onEditText?: (item: TextItem) => void;
};

/**
 * The canvas everything is drawn on. One render function feeds the live preview, the photo export and the
 * recorded video. Overlays are moved by drag, resized/rotated by two-finger pinch, deleted by dropping them
 * on the bin; drawing uses the brush when `tool === 'draw'`.
 */
const CameraStage = forwardRef<StageHandle, Props>(function CameraStage(
  { videoRef, mirror, frozen, scene, onScene, tool, brush, interactive, paused, onEditText }, ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const frozenRef = useRef(frozen);
  const mirrorRef = useRef(mirror);
  const selectedRef = useRef<string | null>(null);
  const liveRef = useRef<Stroke | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overBin, setOverBin] = useState(false);
  sceneRef.current = scene;
  frozenRef.current = frozen;
  mirrorRef.current = mirror;

  const source = useCallback((): Source | null => {
    if (frozenRef.current) return { image: frozenRef.current, width: STAGE_W, height: STAGE_H, mirror: false };
    const v = videoRef.current;
    if (v && v.readyState >= 2 && v.videoWidth > 0) return { image: v, width: v.videoWidth, height: v.videoHeight, mirror: mirrorRef.current };
    return null;
  }, [videoRef]);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current!,
    takeFrame: () => {
      const src = source();
      if (!src) return null;
      const c = document.createElement('canvas');
      c.width = STAGE_W;
      c.height = STAGE_H;
      drawScene(c.getContext('2d')!, src, EMPTY_SCENE, 0);
      return c;
    },
    exportImage: () =>
      new Promise<Blob>((resolve, reject) => {
        const c = document.createElement('canvas');
        c.width = STAGE_W;
        c.height = STAGE_H;
        drawScene(c.getContext('2d')!, source(), sceneRef.current, performance.now());
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/jpeg', PHOTO_QUALITY);
      }),
  }), [source]);

  // render loop
  useEffect(() => {
    if (paused) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    let raf = 0;
    let lastT = 0;
    let lastScene: Scene | null = null;
    let lastSel: string | null = null;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastT < 30) return; // cap at ~30 fps: enough for video, halves the CPU/battery cost
      // A frozen photo with no animated effect only needs redrawing when something actually changed.
      const still = !!frozenRef.current && sceneRef.current.effect === 'none' && !liveRef.current;
      if (still && sceneRef.current === lastScene && selectedRef.current === lastSel) return;
      lastT = t;
      lastScene = sceneRef.current;
      lastSel = selectedRef.current;
      drawScene(ctx, source(), sceneRef.current, t, { selectedId: selectedRef.current, liveStroke: liveRef.current });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, source]);

  // ---- pointer interaction -------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pinch = useRef<{ id: string; scale: number; rot: number; dist: number; angle: number } | null>(null);
  const lastTap = useRef<{ id: string; t: number } | null>(null);

  /**
   * Pointer position -> stage pixels. The canvas is shown with object-fit: contain, so on screens that are
   * not exactly 9:16 (most phones) it is letterboxed: remove that margin before scaling.
   */
  const toStage = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const scale = Math.min(r.width / STAGE_W, r.height / STAGE_H);
    const offX = (r.width - STAGE_W * scale) / 2;
    const offY = (r.height - STAGE_H * scale) / 2;
    return { x: (e.clientX - r.left - offX) / scale, y: (e.clientY - r.top - offY) / scale };
  };
  const patchItem = (id: string, patch: Partial<OverlayItem>) =>
    onScene((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? ({ ...i, ...patch } as OverlayItem) : i)) }));

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = toStage(e);
    pointers.current.set(e.pointerId, p);

    if (tool === 'draw') {
      liveRef.current = { color: brush.color, width: brush.width, points: [[p.x / STAGE_W, p.y / STAGE_H]] };
      return;
    }
    if (pointers.current.size === 2 && selectedRef.current) {
      const [a, b] = [...pointers.current.values()];
      const item = sceneRef.current.items.find((i) => i.id === selectedRef.current);
      if (item) {
        pinch.current = { id: item.id, scale: item.scale, rot: item.rotation, dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, angle: Math.atan2(b.y - a.y, b.x - a.x) };
        drag.current = null;
      }
      return;
    }
    const hit = hitTest(canvasRef.current!.getContext('2d')!, sceneRef.current.items, p.x, p.y);
    if (hit) {
      selectedRef.current = hit.id;
      onScene((s) => ({ ...s, items: [...s.items.filter((i) => i.id !== hit.id), hit] })); // bring to front
      drag.current = { id: hit.id, dx: p.x - hit.x * STAGE_W, dy: p.y - hit.y * STAGE_H };
      const now = Date.now();
      if (hit.type === 'text' && lastTap.current?.id === hit.id && now - lastTap.current.t < 320) onEditText?.(hit);
      lastTap.current = { id: hit.id, t: now };
    } else {
      selectedRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || !pointers.current.has(e.pointerId)) return;
    const p = toStage(e);
    pointers.current.set(e.pointerId, p);

    if (tool === 'draw' && liveRef.current) {
      const pts = liveRef.current.points;
      const last = pts[pts.length - 1];
      if (Math.hypot((p.x / STAGE_W - last[0]) * STAGE_W, (p.y / STAGE_H - last[1]) * STAGE_H) > 3) pts.push([p.x / STAGE_W, p.y / STAGE_H]);
      return;
    }
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const g = pinch.current;
      patchItem(g.id, { scale: Math.min(6, Math.max(0.2, (g.scale * dist) / g.dist)), rotation: g.rot + (angle - g.angle) });
      return;
    }
    if (drag.current && pointers.current.size === 1) {
      const d = drag.current;
      patchItem(d.id, { x: Math.min(1.1, Math.max(-0.1, (p.x - d.dx) / STAGE_W)), y: Math.min(1.1, Math.max(-0.1, (p.y - d.dy) / STAGE_H)) });
      setDragging(true);
      setOverBin(p.y > STAGE_H * 0.86);
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = pointers.current.get(e.pointerId)!;
    pointers.current.delete(e.pointerId);
    if (tool === 'draw' && liveRef.current) {
      const stroke = liveRef.current;
      liveRef.current = null;
      onScene((s) => ({ ...s, strokes: [...s.strokes, stroke] }));
      return;
    }
    if (drag.current && p.y > STAGE_H * 0.86) {
      const id = drag.current.id;
      onScene((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
      selectedRef.current = null;
    }
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) { drag.current = null; setDragging(false); setOverBin(false); }
  };

  // drop the selection highlight when leaving interactive mode
  useEffect(() => { if (!interactive) selectedRef.current = null; }, [interactive]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={STAGE_W}
        height={STAGE_H}
        data-testid="camera-stage"
        className={`w-full h-full object-contain ${interactive ? 'touch-none' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />
      {dragging && (
        <div
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center justify-center w-14 h-14 rounded-full transition-all ${
            overBin ? 'bg-red-500 scale-125' : 'bg-black/55'
          } text-white`}
          aria-hidden="true"
        >
          <Trash2 className="w-6 h-6" />
        </div>
      )}
    </div>
  );
});

export default CameraStage;
