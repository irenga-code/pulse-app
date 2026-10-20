import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { DEFAULT_REACTIONS, type ReactionType } from '@/lib/types';

let cache: ReactionType[] | null = null;
let inflight: Promise<ReactionType[]> | null = null;

function load(): Promise<ReactionType[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api
    .listReactionTypes()
    .then((rows) => (cache = rows.length ? rows : DEFAULT_REACTIONS))
    .catch(() => DEFAULT_REACTIONS)
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * The emoji palette from the database (admins can add/retire emojis without a deploy).
 * Renders the built-in palette immediately and swaps in the live one when it arrives.
 */
export function useReactionPalette() {
  const [palette, setPalette] = useState<ReactionType[]>(cache ?? DEFAULT_REACTIONS);
  useEffect(() => {
    let active = true;
    load().then((p) => active && setPalette(p));
    return () => { active = false; };
  }, []);
  return palette;
}

export const emojiFor = (palette: ReactionType[], kind: string) => palette.find((p) => p.kind === kind)?.emoji ?? '👍';
