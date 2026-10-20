/** Output size of every snap (9:16). 720x1280 keeps photos ~200 KB and 15 s of video under ~5 MB. */
export const STAGE_W = 720;
export const STAGE_H = 1280;
export const MAX_VIDEO_MS = 15_000;
export const LONG_PRESS_MS = 250;
export const PHOTO_QUALITY = 0.88;
export const VIDEO_BITS_PER_SECOND = 2_500_000;
export const MAX_CAPTION = 300;

export type FilterId = 'none' | 'neon' | 'noir' | 'warm' | 'club' | 'vintage' | 'glow';
export type EffectId = 'none' | 'confetti' | 'disco' | 'frame' | 'sparkle';

export type FilterDef = {
  id: FilterId;
  label: string;
  /** Canvas/CSS filter string (Chrome, Firefox, Edge). */
  css: string;
  /** Fallback for browsers without ctx.filter (Safari): a colour wash drawn over the frame. */
  tint?: { color: string; alpha: number; mode: GlobalCompositeOperation };
};

export const FILTERS: FilterDef[] = [
  { id: 'none', label: 'Normal', css: 'none' },
  { id: 'neon', label: 'Neon', css: 'saturate(1.7) contrast(1.15) hue-rotate(-18deg) brightness(1.05)', tint: { color: '#ff2bd6', alpha: 0.22, mode: 'overlay' } },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.25) brightness(0.95)', tint: { color: '#808080', alpha: 0.85, mode: 'color' } },
  { id: 'warm', label: 'Sunset', css: 'sepia(0.35) saturate(1.5) brightness(1.05) contrast(1.05)', tint: { color: '#ff8a3d', alpha: 0.22, mode: 'overlay' } },
  { id: 'club', label: 'Club', css: 'hue-rotate(190deg) saturate(1.5) contrast(1.1) brightness(0.95)', tint: { color: '#3b2bff', alpha: 0.28, mode: 'overlay' } },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.55) contrast(0.92) brightness(1.05) saturate(0.9)', tint: { color: '#b98a4a', alpha: 0.3, mode: 'overlay' } },
  { id: 'glow', label: 'Glow', css: 'brightness(1.12) contrast(1.08) saturate(1.25) blur(0.6px)', tint: { color: '#ffffff', alpha: 0.12, mode: 'soft-light' } },
];

export const EFFECTS: { id: EffectId; label: string; icon: string }[] = [
  { id: 'none', label: 'None', icon: '🚫' },
  { id: 'confetti', label: 'Confetti', icon: '🎊' },
  { id: 'disco', label: 'Disco', icon: '🪩' },
  { id: 'frame', label: 'Neon frame', icon: '💜' },
  { id: 'sparkle', label: 'Sparkle', icon: '✨' },
];

export type StickerDef = { id: string; value: string; label: string; badge?: boolean };

export const STICKERS: StickerDef[] = [
  { id: 'live', value: 'LIVE', label: 'Live badge', badge: true },
  { id: 'pulse', value: 'PULSE', label: 'Pulse badge', badge: true },
  { id: 'kla', value: 'KAMPALA NIGHTS', label: 'Kampala Nights badge', badge: true },
  { id: 'vip', value: 'VIP', label: 'VIP badge', badge: true },
  { id: 'soldout', value: 'SOLD OUT', label: 'Sold out badge', badge: true },
  ...['🔥', '🎉', '🪩', '🍾', '🥂', '🎶', '💃', '🕺', '😎', '🕶️', '👑', '💎', '🦁', '🇺🇬', '✨', '💥', '❤️', '😂', '🤩', '🥳', '🍻', '🎤', '🎧', '🚖'].map(
    (e) => ({ id: `e-${e}`, value: e, label: e })
  ),
];

export type TextStyle = 'classic' | 'neon' | 'bar' | 'outline';
export const TEXT_STYLES: { id: TextStyle; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'neon', label: 'Neon' },
  { id: 'bar', label: 'Bar' },
  { id: 'outline', label: 'Outline' },
];
export const COLORS = ['#ffffff', '#000000', '#ff2bd6', '#ff3b30', '#ff9f0a', '#ffd60a', '#30d158', '#00a884', '#0a84ff', '#bf5af2'];
export const BRUSH_SIZES = [6, 14, 28];
