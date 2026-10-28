import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * WhatsApp's live "typing…" / "recording audio…" status, over Supabase Realtime broadcast (nothing is stored).
 *
 * One broadcast channel per conversation, `typing:<conversation id>`: only the two people in a chat can read its id,
 * so nobody else can listen in. The open chat and the chat list share the channel (reference counted). The sender
 * repeats its status every few seconds and the receiver drops it when the repeats stop, so a closed tab or lost
 * connection never leaves "typing…" stuck.
 */
export type ChatActivity = 'typing' | 'recording';

const REPEAT_MS = 3000;   // sender re-announces this often while active
const EXPIRE_MS = 6000;   // receiver forgets a status this long after the last announcement
const IDLE_MS = 5000;     // no keystroke for this long = stopped typing

type Entry = { kind: ChatActivity; from: string; timer: number };
let state: Record<string, Entry | undefined> = {};
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((fn) => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => state;

function apply(conversationId: string, from: string, kind: ChatActivity | null) {
  const old = state[conversationId];
  if (old) window.clearTimeout(old.timer);
  if (!kind) {
    if (!old) return;
    state = { ...state, [conversationId]: undefined };
  } else {
    const timer = window.setTimeout(() => apply(conversationId, from, null), EXPIRE_MS);
    state = { ...state, [conversationId]: { kind, from, timer } };
  }
  emit();
}

// shared channels, one per conversation
const channels = new Map<string, { channel: RealtimeChannel; users: number }>();
function watch(conversationId: string) {
  let c = channels.get(conversationId);
  if (!c) {
    const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'activity' }, ({ payload }) => {
        const p = payload as { from?: unknown; kind?: unknown };
        if (typeof p.from !== 'string') return;
        apply(conversationId, p.from, p.kind === 'typing' || p.kind === 'recording' ? p.kind : null);
      })
      .subscribe();
    c = { channel, users: 0 };
    channels.set(conversationId, c);
  }
  c.users++;
  return () => {
    const cur = channels.get(conversationId);
    if (!cur || --cur.users > 0) return;
    channels.delete(conversationId);
    void supabase.removeChannel(cur.channel);
  };
}
function announce(conversationId: string, from: string, kind: ChatActivity | null) {
  void channels.get(conversationId)?.channel.send({ type: 'broadcast', event: 'activity', payload: { from, kind } });
}

/** The other person's live status in one chat (null when idle). Your own other tabs are ignored. */
export function useChatActivity(conversationId: string | null, me: string | null): ChatActivity | null {
  useEffect(() => (conversationId ? watch(conversationId) : undefined), [conversationId]);
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const e = conversationId ? all[conversationId] : undefined;
  return e && e.from !== me ? e.kind : null;
}

/** Live statuses for the chats in a list (capped, so a long list does not open dozens of channels). */
export function useChatActivities(conversationIds: string[], me: string | null, max = 40): Record<string, ChatActivity | undefined> {
  const key = conversationIds.slice(0, max).join(',');
  useEffect(() => {
    if (!key) return;
    const stops = key.split(',').map(watch);
    return () => stops.forEach((stop) => stop());
  }, [key]);
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const out: Record<string, ChatActivity | undefined> = {};
  for (const [id, e] of Object.entries(all)) if (e && e.from !== me) out[id] = e.kind;
  return out;
}

/**
 * Announce your own status in the open chat: call typed() on every keystroke and stopped() when the message is sent.
 * While `recording` is true it announces "recording" instead. Goes quiet when disabled (e.g. blocked) or closed.
 */
export function useChatActivitySender(conversationId: string | null, me: string | null, recording: boolean, enabled = true) {
  const current = useRef<ChatActivity | null>(null);
  const lastSent = useRef(0);
  const idle = useRef<number | undefined>(undefined);
  const live = !!(conversationId && me && enabled);

  const send = useCallback((kind: ChatActivity | null) => {
    if (!conversationId || !me) return;
    if (kind === null && current.current === null) return;
    current.current = kind;
    lastSent.current = Date.now();
    announce(conversationId, me, kind);
  }, [conversationId, me]);

  useEffect(() => {
    if (!live || !conversationId) return;
    const stop = watch(conversationId);
    return () => { window.clearTimeout(idle.current); send(null); stop(); };
  }, [live, conversationId, send]);

  // recording: announce now and keep repeating until it ends
  useEffect(() => {
    if (!live || !recording) return;
    window.clearTimeout(idle.current);
    send('recording');
    const t = window.setInterval(() => send('recording'), REPEAT_MS);
    return () => { window.clearInterval(t); send(null); };
  }, [live, recording, send]);

  const typed = useCallback(() => {
    if (!live || recording) return;
    if (current.current !== 'typing' || Date.now() - lastSent.current > REPEAT_MS) send('typing');
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => send(null), IDLE_MS);
  }, [live, recording, send]);
  const stopped = useCallback(() => { window.clearTimeout(idle.current); send(null); }, [send]);

  return { typed, stopped };
}
