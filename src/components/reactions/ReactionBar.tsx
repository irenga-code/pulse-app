import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import ReactionPicker from '@/components/reactions/ReactionPicker';
import { useReactionPalette } from '@/hooks/useReactionPalette';
import type { ReactionCounts, ReactionKind } from '@/lib/types';

type Props = {
  counts: ReactionCounts;
  mine: ReactionKind | null;
  onReact: (kind: ReactionKind) => void;
  /** Smaller pills (used on venue cards). */
  compact?: boolean;
  /** Reaction kinds that are shown elsewhere (e.g. 'heart' = the like button) and so are left out of the pill row. */
  exclude?: ReactionKind[];
};

/**
 * Emoji reactions: the first three palette emojis are always one tap away, any other emoji people used
 * appears as a pill (tap to join / undo), and "+" opens the full palette.
 */
export default function ReactionBar({ counts, mine, onReact, compact, exclude }: Props) {
  const fullPalette = useReactionPalette();
  const palette = exclude?.length ? fullPalette.filter((p) => !exclude.includes(p.kind)) : fullPalette;
  const [open, setOpen] = useState(false);

  // The first three palette emojis are always one tap away; any other emoji people used shows as a pill too.
  const quick = palette.slice(0, 3);
  const extras = palette
    .slice(3)
    .filter((p) => (counts[p.kind] ?? 0) > 0 || mine === p.kind)
    .sort((a, b) => (counts[b.kind] ?? 0) - (counts[a.kind] ?? 0) || a.sort - b.sort);
  const pad = compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  const pill = (kind: string, emoji: string, label: string) => {
    const active = mine === kind;
    const n = counts[kind] ?? 0;
    return (
      <button
        type="button"
        key={kind}
        onClick={() => onReact(kind)}
        aria-pressed={active}
        aria-label={`${label}${n ? `, ${n}` : ''}`}
        className={`flex items-center gap-1 rounded-full font-medium border transition-all active:scale-90 ${pad} ${
          active
            ? 'bg-wa-green/15 border-wa-green/50 text-wa-green'
            : 'border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:border-wa-green/40'
        }`}
      >
        <span className={compact ? 'text-sm leading-none' : 'text-base leading-none'}>{emoji}</span>
        {n > 0 && <span>{n}</span>}
      </button>
    );
  };

  return (
    <div className="relative flex items-center gap-1.5 flex-wrap" role="group" aria-label="Reactions">
      {[...quick, ...extras].map((p) => pill(p.kind, p.emoji, p.label))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More reactions"
        aria-expanded={open}
        className={`rounded-full border border-dashed border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green hover:border-wa-green/50 transition-colors ${compact ? 'p-1' : 'p-1.5'}`}
      >
        <SmilePlus className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </button>
      {open && <ReactionPicker mine={mine} onPick={onReact} onClose={() => setOpen(false)} />}
    </div>
  );
}
