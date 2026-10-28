import { api } from './apiClient';
import { cacheAge, fetchInto, memUserKey, readCache } from './cache';
import type { ChatMessage, ConversationSummary, PublicProfile } from './types';

/**
 * What an open chat needs to paint, kept in memory per person you talk to, so opening (or re-opening) a chat
 * shows it at once and the network only refreshes it. Memory only (`mem:` key): messages can vanish, so they
 * never go to localStorage, and they are wiped on sign-out with the rest of the user's cache.
 */
export type ChatSnapshot = {
  convId: string;
  other: PublicProfile | null;
  messages: ChatMessage[];
  hasOlder: boolean;
  vanish: boolean;
  pinnedId: string | null;
};

/** First screen of history. */
export const FIRST_PAGE = 100;

export const chatKey = (me: string, otherUserId: string) => memUserKey(me, `chat:${otherUserId}`);

/** The inbox's cached row for this person (ConversationList keeps it under memUserKey(me, 'inbox')). */
type Inbox = { rows: ConversationSummary[]; people: Record<string, PublicProfile>; prefs: Record<string, { is_favorite?: boolean }>; blocked: string[] };

/** Whatever is already known about this chat: a full snapshot from an earlier visit or prefetch, else the inbox row. */
export function seedChat(me: string, otherUserId: string): (Partial<ChatSnapshot> & { convId: string; favorite?: boolean; blocked?: boolean }) | null {
  const inbox = readCache<Inbox>(memUserKey(me, 'inbox'));
  const row = inbox?.rows.find((r) => r.other_user_id === otherUserId);
  const fromInbox = row && inbox ? {
    convId: row.conversation_id,
    other: inbox.people[otherUserId] ?? null,
    vanish: row.vanish_mode,
    favorite: !!inbox.prefs[row.conversation_id]?.is_favorite,
    blocked: inbox.blocked.includes(otherUserId),
  } : null;
  const snap = readCache<ChatSnapshot>(chatKey(me, otherUserId));
  if (!snap) return fromInbox;
  return { ...fromInbox, ...snap, other: snap.other ?? fromInbox?.other ?? null };
}

/** Latest page of history and the conversation's settings; concurrent calls for the same chat share one request. */
export function loadChat(me: string, otherUserId: string, convId: string, other: PublicProfile | null) {
  return fetchInto<ChatSnapshot>(chatKey(me, otherUserId), async () => {
    const [messages, conv] = await Promise.all([api.listMessages(convId, FIRST_PAGE), api.getConversation(convId)]);
    return { convId, other, messages, hasOlder: messages.length >= FIRST_PAGE, vanish: !!conv?.vanish_mode, pinnedId: conv?.pinned_message_id ?? null };
  });
}

/** Warm a chat before it opens (hovering or pressing its row in the list). */
export function prefetchChat(me: string, otherUserId: string, convId: string, other: PublicProfile | null) {
  if (cacheAge(chatKey(me, otherUserId)) < 15_000) return;
  loadChat(me, otherUserId, convId, other).catch(() => undefined); // the chat tries again when it opens
}
