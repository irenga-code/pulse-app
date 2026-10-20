import { api } from '@/lib/apiClient';

/**
 * Batches "this post was on screen" signals into one request every few seconds.
 * The database counts each signed-in viewer once per post and ignores the author, so duplicates are harmless;
 * we still remember what was sent to avoid pointless traffic.
 */
const sent = new Set<string>();
const pending = new Set<string>();
let timer: number | undefined;

async function flush() {
  timer = undefined;
  const ids = [...pending].slice(0, 50);
  ids.forEach((id) => pending.delete(id));
  if (ids.length === 0) return;
  ids.forEach((id) => sent.add(id));
  try {
    await api.recordPostViews(ids);
  } catch {
    /* views are best-effort: never bother the user */
  }
  if (pending.size > 0) timer = window.setTimeout(flush, 3000);
}

export function enqueueView(postId: string) {
  if (sent.has(postId) || pending.has(postId)) return;
  pending.add(postId);
  if (timer === undefined) timer = window.setTimeout(flush, 3000);
}

/** For tests / sign-out. */
export function resetViewQueue() {
  sent.clear();
  pending.clear();
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
}
