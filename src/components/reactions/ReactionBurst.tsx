import { useEffect } from 'react';

import type { Burst } from '@/components/reactions/bursts';

/** Floating emoji layer. Put it inside a `relative` container; it never blocks taps. */
export default function ReactionBurst({ items, onDone }: { items: Burst[]; onDone: (id: number) => void }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {items.map((b) => (
        <FloatingEmoji key={b.id} burst={b} onDone={onDone} />
      ))}
    </div>
  );
}

function FloatingEmoji({ burst, onDone }: { burst: Burst; onDone: (id: number) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDone(burst.id), 1700);
    return () => window.clearTimeout(t);
  }, [burst.id, onDone]);
  return (
    <span
      data-testid="reaction-float"
      className="reaction-float absolute bottom-2 text-3xl select-none"
      style={{ left: `${burst.x}%`, ['--drift' as string]: `${burst.drift}px` }}
    >
      {burst.emoji}
    </span>
  );
}
