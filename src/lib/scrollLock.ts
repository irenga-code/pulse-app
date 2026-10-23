let locks = 0;
let saved = '';

/**
 * Stops the page scrolling behind an overlay. Counted, so stacked or swapped overlays
 * closing in any order always give the page its scroll back. Returns the unlock function.
 */
export function lockBodyScroll(): () => void {
  if (locks++ === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = saved;
  };
}
