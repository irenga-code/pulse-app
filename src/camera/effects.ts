import type { EffectId } from '@/camera/constants';

/** Deterministic pseudo-random in [0,1) so effects animate smoothly without storing particle state. */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const CONFETTI = ['#ff2bd6', '#ffd60a', '#30d158', '#0a84ff', '#ff453a', '#bf5af2', '#ffffff'];

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const rad = i % 2 === 0 ? r : r * 0.28;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * AR-style animated effects, composited into the live preview, photos and recorded video.
 * (Face-anchored AR needs a tracking model such as MediaPipe; this is the pluggable slot for it.)
 */
export function drawEffect(ctx: CanvasRenderingContext2D, id: EffectId, t: number, w: number, h: number) {
  if (id === 'none') return;
  ctx.save();
  if (id === 'confetti') {
    for (let i = 0; i < 46; i++) {
      const speed = 0.12 + rnd(i, 1) * 0.22;
      const y = ((rnd(i, 2) * (h + 80) + t * speed) % (h + 80)) - 40;
      const x = rnd(i, 3) * w + Math.sin(t / 600 + i) * 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t / 400 + i);
      ctx.fillStyle = CONFETTI[i % CONFETTI.length];
      ctx.fillRect(-7, -4, 14, 8);
      ctx.restore();
    }
  } else if (id === 'disco') {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i++) {
      const a = t / 1800 + (i * Math.PI) / 2;
      const grad = ctx.createLinearGradient(w / 2, -40, w / 2 + Math.cos(a) * w, h * 0.9);
      grad.addColorStop(0, `hsla(${(t / 12 + i * 90) % 360}, 100%, 60%, 0.5)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 20, -40);
      ctx.lineTo(w / 2 + 20, -40);
      ctx.lineTo(w / 2 + Math.cos(a) * w * 1.1 + 160, h);
      ctx.lineTo(w / 2 + Math.cos(a) * w * 1.1 - 160, h);
      ctx.closePath();
      ctx.fill();
    }
  } else if (id === 'frame') {
    const hue = (t / 14) % 360;
    ctx.strokeStyle = `hsl(${hue}, 100%, 62%)`;
    ctx.shadowColor = `hsl(${hue}, 100%, 62%)`;
    ctx.shadowBlur = 36;
    ctx.lineWidth = 16;
    ctx.strokeRect(14, 14, w - 28, h - 28);
  } else if (id === 'sparkle') {
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffe9a8';
    ctx.shadowBlur = 14;
    for (let i = 0; i < 26; i++) {
      const a = (Math.sin(t / 320 + i * 1.7) + 1) / 2;
      ctx.globalAlpha = a * 0.95;
      star(ctx, rnd(i, 4) * w, rnd(i, 5) * h, 10 + rnd(i, 6) * 18 * a);
    }
  }
  ctx.restore();
}
