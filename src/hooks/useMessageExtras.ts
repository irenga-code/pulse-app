import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { MessageReaction } from '@/lib/types';

let channelCounter = 0;

/** Reactions grouped for a bubble: [{ emoji, count, mine }], most used first. */
export type ReactionSummary = { emoji: string; count: number; mine: boolean }[];

/**
 * Per-message extras for one open chat (migration 19): everyone's reactions (live), your stars and the messages you
 * deleted for yourself. Changes are applied on screen first and rolled back if the server says no.
 */
export function useMessageExtras(messageIds: string[], me: string) {
  const { show } = useToast();
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const key = messageIds.join(',');
  const idsRef = useRef(messageIds);
  idsRef.current = messageIds;

  // only the newest load may apply, and never one that started before a change made on this screen
  // (otherwise an older answer could briefly undo a reaction you just tapped)
  const request = useRef(0);
  const changes = useRef(0);
  const load = useCallback(async () => {
    const ids = idsRef.current;
    const req = ++request.current;
    const changesAtStart = changes.current;
    try {
      const x = await api.messageExtras(ids);
      if (req !== request.current || changes.current !== changesAtStart) return;
      setReactions(x.reactions);
      setStarred(new Set(x.starred));
      setHidden(new Set(x.hidden));
    } catch { /* optional extras: keep what is on screen */ }
  }, []);

  useEffect(() => { void load(); }, [key, load]);

  // reactions arrive live (Realtime only sends rows we may read; ignore other chats)
  useEffect(() => {
    let t: number | undefined;
    const channel = supabase.channel(`message-reactions-${++channelCounter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as Partial<MessageReaction>;
        if (row.message_id && !idsRef.current.includes(row.message_id)) return;
        window.clearTimeout(t);
        t = window.setTimeout(() => { void load(); }, 250);
      })
      .subscribe();
    return () => { window.clearTimeout(t); supabase.removeChannel(channel); };
  }, [load]);

  const summary = useMemo(() => {
    const by = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of reactions) {
      const m = by.get(r.message_id) ?? new Map();
      const cur = m.get(r.emoji) ?? { count: 0, mine: false };
      m.set(r.emoji, { count: cur.count + 1, mine: cur.mine || r.user_id === me });
      by.set(r.message_id, m);
    }
    const out: Record<string, ReactionSummary> = {};
    for (const [id, m] of by) out[id] = [...m].map(([emoji, v]) => ({ emoji, ...v })).sort((a, b) => b.count - a.count);
    return out;
  }, [reactions, me]);

  const myReaction = useCallback((messageId: string) => reactions.find((r) => r.message_id === messageId && r.user_id === me)?.emoji ?? null, [reactions, me]);

  /** Tap an emoji: set it, switch to it, or (same emoji again) take it back. */
  const react = useCallback(async (messageId: string, emoji: string) => {
    const before = reactions;
    const current = before.find((r) => r.message_id === messageId && r.user_id === me)?.emoji ?? null;
    const next = current === emoji ? null : emoji;
    changes.current++;
    setReactions([...before.filter((r) => !(r.message_id === messageId && r.user_id === me)), ...(next ? [{ message_id: messageId, user_id: me, emoji: next }] : [])]);
    try {
      await api.setMessageReaction(messageId, me, next);
      void load(); // confirm against the server now that the change is saved
    } catch (e) {
      setReactions(before);
      show(friendlyError(e), 'error');
    }
  }, [reactions, me, show, load]);

  const toggleStar = useCallback(async (messageId: string) => {
    const on = !starred.has(messageId);
    changes.current++;
    setStarred((s) => { const n = new Set(s); if (on) n.add(messageId); else n.delete(messageId); return n; });
    try {
      await api.setMessageStar(messageId, me, on);
      show(on ? 'Message starred' : 'Message unstarred');
    } catch (e) {
      setStarred((s) => { const n = new Set(s); if (on) n.delete(messageId); else n.add(messageId); return n; });
      show(friendlyError(e), 'error');
    }
  }, [starred, me, show]);

  const hideForMe = useCallback(async (messageId: string) => {
    changes.current++;
    setHidden((s) => new Set(s).add(messageId));
    try {
      await api.hideMessage(messageId);
    } catch (e) {
      setHidden((s) => { const n = new Set(s); n.delete(messageId); return n; });
      throw e;
    }
  }, []);

  return { summary, myReaction, react, starred, toggleStar, hidden, hideForMe, reload: load };
}
