import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (false where matchMedia is missing, e.g. tests). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
    () => false,
  );
}

/** Tailwind's md breakpoint: the rail layout. */
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
