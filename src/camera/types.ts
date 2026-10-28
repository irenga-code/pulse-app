import type { SnapMeta } from '@/lib/types';
import type { EffectId, FilterId, TextStyle } from '@/camera/constants';

type ItemBase = { id: string; /** centre, 0..1 of the stage */ x: number; y: number; scale: number; /** radians */ rotation: number };

export type TextItem = ItemBase & { type: 'text'; text: string; style: TextStyle; color: string };
export type StickerItem = ItemBase & { type: 'sticker'; value: string; badge?: boolean };
export type OverlayItem = TextItem | StickerItem;

/** Freehand stroke; points are 0..1 of the stage so it survives resizing. */
export type Stroke = { color: string; width: number; points: [number, number][] };


export type Scene = {
  filter: FilterId;
  effect: EffectId;
  items: OverlayItem[];
  strokes: Stroke[];
  /** e.g. "Kampala" (only the label, never coordinates) */
  geoLabel: string | null;
};

export const EMPTY_SCENE: Scene = { filter: 'none', effect: 'none', items: [], strokes: [], geoLabel: null };

export type CaptureResult = {
  kind: 'image' | 'video';
  blob: Blob;
  ext: string;
  width: number;
  height: number;
  durationMs?: number;
  previewUrl: string;
  meta: SnapMeta;
};
