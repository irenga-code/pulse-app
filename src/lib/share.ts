/** Link that opens a single post inside the app (handled by the hash route in App.tsx). */
export function postLink(postId: string): string {
  return `${window.location.origin}${window.location.pathname}#/post/${postId}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Use the phone's share sheet when there is one, otherwise copy the link to the clipboard. */
export async function shareLink(opts: { url: string; title: string; text?: string }): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // fall through to copy
    }
  }
  try {
    await navigator.clipboard.writeText(opts.url);
    return 'copied';
  } catch {
    try {
      // old browsers / insecure origins
      const ta = document.createElement('textarea');
      ta.value = opts.url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok ? 'copied' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
