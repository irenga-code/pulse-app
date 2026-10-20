import { useEffect, useRef } from 'react';
import { useReactionPalette } from '@/hooks/useReactionPalette';
import type { ReactionKind } from '@/lib/types';

/** Popover with the full emoji palette. Esc / outside click closes. */
export default function ReactionPicker({ mine, onPick, onClose }: {
  mine: ReactionKind | null; onPick: (kind: ReactionKind) => void; onClose: () => void;
}) {
  const palette = useReactionPalette();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Choose a reaction"
      className="absolute z-30 bottom-full mb-2 left-0 flex flex-wrap gap-1 max-w-[15rem] rounded-2xl p-2 bg-wa-lightPanel dark:bg-wa-darkPanel border border-wa-lightBorder dark:border-wa-darkBorder shadow-2xl animate-fade-in"
    >
      {palette.map((r) => (
        <button
          type="button"
          key={r.kind}
          role="menuitemradio"
          aria-checked={mine === r.kind}
          aria-label={r.label}
          title={r.label}
          onClick={() => { onPick(r.kind); onClose(); }}
          className={`w-10 h-10 text-2xl rounded-xl transition-transform hover:scale-125 active:scale-90 ${mine === r.kind ? 'bg-wa-green/20' : 'hover:bg-wa-green/10'}`}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}
