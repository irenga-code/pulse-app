import { useEffect, type RefObject } from 'react';
import { enqueueView } from '@/lib/viewQueue';

/** Counts a view once the element has been at least half visible for one second. */
export function useViewTracker(ref: RefObject<Element | null>, postId: string, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
        if (visible && timer === undefined) {
          timer = window.setTimeout(() => { enqueueView(postId); io.disconnect(); }, 1000);
        } else if (!visible && timer !== undefined) {
          window.clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [0, 0.5] }
    );
    io.observe(el);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      io.disconnect();
    };
  }, [ref, postId, enabled]);
}
