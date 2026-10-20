import { FILTERS, STAGE_H, STAGE_W } from '@/camera/constants';
import { drawEffect } from '@/camera/effects';
import type { OverlayItem, Scene, Stroke } from '@/camera/types';

export type Source = { image: CanvasImageSource; width: number; height: number; mirror: boolean };

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const TEXT_FONT = '800 {S}px "Inter","Segoe UI",system-ui,-apple-system,sans-serif';
const BASE_EMOJI = 150;
const BASE_TEXT = 76;
const BASE_BADGE = 66;

/** Crop (cover-fit) a source into a destination of another aspect ratio. */
export function coverRect(sw: number, sh: number, dw: number, dh: number) {
  const srcRatio = sw / sh;
  const dstRatio = dw / dh;
  if (srcRatio > dstRatio) {
    const w = sh * dstRatio;
    return { sx: (sw - w) / 2, sy: 0, sw: w, sh };
  }
  const h = sw / dstRatio;
  return { sx: 0, sy: (sh - h) / 2, sw, sh: h };
}

const supportsFilter = (ctx: CanvasRenderingContext2D) => 'filter' in ctx;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (s.points.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = s.points.map(([x, y]) => [x * w, y * h] as const);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 34) {
  ctx.save();
  ctx.font = `700 ${size}px ${EMOJI_FONT}`;
  ctx.textBaseline = 'middle';
  const padX = 22;
  const wTxt = ctx.measureText(text).width;
  const hBox = size + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, wTxt + padX * 2, hBox, hBox / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + padX, y + hBox / 2 + 1);
  ctx.restore();
}

/** Local-space half size of an item at scale 1 (used for drawing backgrounds, selection and hit testing). */
export function itemBox(ctx: CanvasRenderingContext2D, item: OverlayItem) {
  ctx.save();
  let wBox: number, hBox: number;
  if (item.type === 'sticker' && !item.badge) {
    ctx.font = `${BASE_EMOJI}px ${EMOJI_FONT}`;
    wBox = Math.max(ctx.measureText(item.value).width, BASE_EMOJI * 0.8);
    hBox = BASE_EMOJI * 1.05;
  } else {
    const size = item.type === 'sticker' ? BASE_BADGE : BASE_TEXT;
    ctx.font = TEXT_FONT.replace('{S}', String(size));
    const lines = (item.type === 'sticker' ? item.value : item.text).split('\n');
    wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + (item.type === 'sticker' ? 56 : 36);
    hBox = lines.length * size * 1.2 + (item.type === 'sticker' ? 30 : 16);
  }
  ctx.restore();
  return { hw: wBox / 2, hh: hBox / 2 };
}

function drawItem(ctx: CanvasRenderingContext2D, item: OverlayItem, w: number, h: number, selected: boolean) {
  ctx.save();
  ctx.translate(item.x * w, item.y * h);
  ctx.rotate(item.rotation);
  ctx.scale(item.scale, item.scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const { hw, hh } = itemBox(ctx, item);

  if (item.type === 'sticker' && !item.badge) {
    ctx.font = `${BASE_EMOJI}px ${EMOJI_FONT}`;
    ctx.fillText(item.value, 0, 0);
  } else if (item.type === 'sticker') {
    // neon badge
    ctx.font = TEXT_FONT.replace('{S}', String(BASE_BADGE));
    ctx.fillStyle = 'rgba(10,10,20,0.78)';
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, 18);
    ctx.fill();
    ctx.strokeStyle = '#ff2bd6';
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(item.value, 0, 3);
  } else {
    ctx.font = TEXT_FONT.replace('{S}', String(BASE_TEXT));
    const lines = item.text.split('\n');
    const lineH = BASE_TEXT * 1.2;
    const top = (-(lines.length - 1) * lineH) / 2;
    if (item.style === 'bar') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, -hw, -hh, hw * 2, hh * 2, 14);
      ctx.fill();
    }
    lines.forEach((line, i) => {
      const y = top + i * lineH;
      if (item.style === 'neon') {
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 28;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(line, 0, y);
        ctx.shadowBlur = 12;
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.55;
        ctx.fillText(line, 0, y);
        ctx.globalAlpha = 1;
      } else if (item.style === 'outline') {
        ctx.lineWidth = 10;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        ctx.strokeText(line, 0, y);
        ctx.fillStyle = item.color;
        ctx.fillText(line, 0, y);
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = item.color;
        ctx.fillText(line, 0, y);
      }
    });
  }

  if (selected) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, -hw - 8, -hh - 8, hw * 2 + 16, hh * 2 + 16, 12);
    ctx.stroke();
  }
  ctx.restore();
}

/** Topmost item under a point (stage pixels), honouring each item's rotation and scale. */
export function hitTest(ctx: CanvasRenderingContext2D, items: OverlayItem[], px: number, py: number, w = STAGE_W, h = STAGE_H): OverlayItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const { hw, hh } = itemBox(ctx, it);
    const dx = px - it.x * w;
    const dy = py - it.y * h;
    const cos = Math.cos(-it.rotation);
    const sin = Math.sin(-it.rotation);
    const lx = (dx * cos - dy * sin) / it.scale;
    const ly = (dx * sin + dy * cos) / it.scale;
    const pad = 24 / it.scale;
    if (Math.abs(lx) <= hw + pad && Math.abs(ly) <= hh + pad) return it;
  }
  return null;
}

export type DrawOptions = { w?: number; h?: number; selectedId?: string | null; liveStroke?: Stroke | null };

/**
 * The whole snap in one function: camera frame -> filter -> effect -> drawing -> stamps -> stickers/text.
 * Used for the live preview, photo export and the recorded video (same pixels everywhere).
 */
export function drawScene(ctx: CanvasRenderingContext2D, src: Source | null, scene: Scene, t: number, opts: DrawOptions = {}) {
  const w = opts.w ?? STAGE_W;
  const h = opts.h ?? STAGE_H;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  if (src && src.width > 0 && src.height > 0) {
    const f = FILTERS.find((x) => x.id === scene.filter);
    const native = !!f && f.css !== 'none' && supportsFilter(ctx);
    ctx.save();
    if (native) ctx.filter = f!.css;
    if (src.mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    const r = coverRect(src.width, src.height, w, h);
    ctx.drawImage(src.image, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    ctx.restore();
    if (f && f.css !== 'none' && !native && f.tint) {
      ctx.save();
      ctx.globalCompositeOperation = f.tint.mode;
      ctx.globalAlpha = f.tint.alpha;
      ctx.fillStyle = f.tint.color;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  drawEffect(ctx, scene.effect, t, w, h);
  for (const s of scene.strokes) drawStroke(ctx, s, w, h);
  if (opts.liveStroke) drawStroke(ctx, opts.liveStroke, w, h);

  if (scene.geoLabel) chip(ctx, `📍 ${scene.geoLabel}`, 36, 56);
  if (scene.stamp) chip(ctx, `🪩 ${scene.stamp.venueName} · ${scene.stamp.location}`, 36, h - 150, 36);

  for (const it of scene.items) drawItem(ctx, it, w, h, it.id === opts.selectedId);
  ctx.restore();
}
