/**
 * Full Unicode emoji catalogue (emojibase), grouped like WhatsApp: Smileys & Emotion, People & Body, Animals & Nature,
 * Food & Drink, Travel & Places, Activities, Objects, Symbols, Flags.
 *
 * The data file (~570 KB) is loaded lazily the first time a picker opens, so it never slows the first page load.
 * Pictures come from Twemoji (see EmojiImg) so an emoji looks identical on Android, iOS and desktop.
 */
import { parse } from 'twemoji-parser';

export type EmojiEntry = {
  /** the emoji itself (what gets inserted into text) */
  e: string;
  /** human name, e.g. "thumbs up" */
  l: string;
  /** search keywords */
  t: string[];
  /** 5 skin-tone variants (light → dark), only for single-person emoji */
  skins?: string[];
};
export type EmojiGroupId = 'smileys' | 'people' | 'animals' | 'food' | 'travel' | 'activities' | 'objects' | 'symbols' | 'flags';
export type EmojiGroup = { id: EmojiGroupId; label: string; items: EmojiEntry[] };

/** emojibase group number -> our category. (Group 2 is skin-tone modifiers: not shown on its own.) */
export const GROUP_META: { num: number; id: EmojiGroupId; label: string }[] = [
  { num: 0, id: 'smileys', label: 'Smileys & Emotion' },
  { num: 1, id: 'people', label: 'People & Body' },
  { num: 3, id: 'animals', label: 'Animals & Nature' },
  { num: 4, id: 'food', label: 'Food & Drink' },
  { num: 5, id: 'travel', label: 'Travel & Places' },
  { num: 6, id: 'activities', label: 'Activities' },
  { num: 7, id: 'objects', label: 'Objects' },
  { num: 8, id: 'symbols', label: 'Symbols' },
  { num: 9, id: 'flags', label: 'Flags' },
];

type Compact = { group?: number; hexcode: string; label: string; tags?: string[]; unicode: string; skins?: { unicode: string }[] };

let cache: Promise<EmojiGroup[]> | null = null;

/** Turn the raw dataset into our groups (exported for tests). */
export function buildGroups(raw: Compact[]): EmojiGroup[] {
  return GROUP_META.map((g) => ({
    id: g.id,
    label: g.label,
    items: raw
      .filter((r) => r.group === g.num)
      .map((r) => ({
        e: r.unicode,
        l: r.label,
        t: r.tags ?? [],
        // only the simple "one person" set (5 tones); couples/handshakes have 25 combos and stay un-toned
        skins: r.skins && r.skins.length === 5 ? r.skins.map((s) => s.unicode) : undefined,
      })),
  }));
}

export function loadEmojiLibrary(): Promise<EmojiGroup[]> {
  cache ??= import('emojibase-data/en/compact.json')
    .then((m) => buildGroups((m.default ?? m) as unknown as Compact[]))
    .catch((e) => { cache = null; throw e; });
  return cache;
}

/**
 * Name or keyword match. Ranked: exact name, name starts with, exact keyword, keyword starts with, name contains,
 * keyword contains (so "pizza" shows the pizza before things that merely mention it).
 */
export function searchEmoji(groups: EmojiGroup[], query: string, limit = 120): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { it: EmojiEntry; score: number }[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      const label = it.l.toLowerCase();
      let score = 0;
      if (it.e === q) score = 7;
      else if (label === q) score = 6;
      else if (label.startsWith(q)) score = 5;
      else if (it.t.some((t) => t === q)) score = 4;
      else if (it.t.some((t) => t.startsWith(q))) score = 3;
      else if (label.includes(q)) score = 2;
      else if (it.t.some((t) => t.includes(q))) score = 1;
      if (score) hits.push({ it, score });
    }
  }
  // stable: equal scores keep the catalogue order
  return hits.map((h, i) => ({ ...h, i })).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((h) => h.it);
}

/** Apply the chosen skin tone (0 = default yellow, 1..5 = light..dark). */
export function withTone(entry: EmojiEntry, tone: number): string {
  return tone >= 1 && tone <= 5 && entry.skins ? entry.skins[tone - 1] : entry.e;
}

// ---------------------------------------------------------------- Twemoji images
/**
 * Where the Twemoji pictures come from (the git tag is v15.1.0). Set VITE_TWEMOJI_BASE to host them yourself
 * (e.g. copy assets/svg from the jdecked/twemoji repo into public/twemoji and use "/twemoji/").
 */
const configuredBase = (import.meta.env.VITE_TWEMOJI_BASE as string | undefined)?.trim();
export const TWEMOJI_BASE = configuredBase ? configuredBase.replace(/\/?$/, '/') : 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@v15.1.0/assets/svg/';
export const twemojiUrl = (codepoints: string) => `${TWEMOJI_BASE}${codepoints}.svg`;

export type TextPart = { type: 'text'; text: string } | { type: 'emoji'; text: string; url: string };

const NON_ASCII = /[\u0080-\uFFFF]/;

/** Split text into plain text and emoji pieces (each emoji piece knows its Twemoji image). */
export function splitEmoji(text: string): TextPart[] {
  if (!text || !NON_ASCII.test(text)) return [{ type: 'text', text }];
  const parts: TextPart[] = [];
  let last = 0;
  for (const ent of parse(text, { buildUrl: twemojiUrl })) {
    const [from, to] = ent.indices;
    if (from > last) parts.push({ type: 'text', text: text.slice(last, from) });
    parts.push({ type: 'emoji', text: ent.text, url: ent.url });
    last = to;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

// ---------------------------------------------------------------- persisted choices
const RECENT_KEY = 'pulse-recent-emojis';
const TONE_KEY = 'pulse-emoji-tone';

export function loadRecent(): string[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]).slice(0, 32); } catch { return []; }
}
export function pushRecent(e: string): string[] {
  const next = [e, ...loadRecent().filter((x) => x !== e)].slice(0, 32);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
export function loadTone(): number {
  try { const n = Number(localStorage.getItem(TONE_KEY)); return n >= 0 && n <= 5 ? n : 0; } catch { return 0; }
}
export function saveTone(n: number) {
  try { localStorage.setItem(TONE_KEY, String(n)); } catch { /* storage unavailable */ }
}
