import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Ghost, MessageCircle, Star, Archive, Users, CheckCheck, BellOff, Plus, Pin, ChevronDown, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import ChatListMenu, { type ChatListAction } from '@/components/social/chat/ChatListMenu';
import Avatar from '@/components/Avatar';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { ListSkeleton } from '@/components/Skeleton';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { chatListTime } from '@/lib/time';
import { clearChat, deleteChat, getChatPrefs, isMutedIn, muteChat, subscribeChatPrefs, unmuteChat } from '@/lib/chatPrefs';
import { contactLabel, useContacts } from '@/lib/contacts';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { memUserKey } from '@/lib/cache';
import type { ConversationPrefs, ConversationSummary, PublicProfile } from '@/lib/types';

export type ChatFilter = 'all' | 'unread' | 'favorites' | 'groups' | 'archived';
const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'groups', label: 'Groups' },
  { id: 'archived', label: 'Archived' },
];

let channelCounter = 0;
type Prefs = Record<string, Pick<ConversationPrefs, 'is_favorite' | 'is_archived' | 'is_pinned' | 'pinned_at' | 'marked_unread'>>;
const isUnread = (c: ConversationSummary, p?: Prefs[string]) => c.unread_count > 0 || !!p?.marked_unread;
const LONG_PRESS_MS = 450;

/**
 * Pure filter + order, exported for tests. Archived chats only show under Archived; a chat you deleted on this device
 * stays out until a newer message arrives; pinned chats come first (most recently pinned on top).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function filterConversations(rows: ConversationSummary[], prefs: Prefs, filter: ChatFilter, query = '', names: Record<string, string> = {},
  deletedAt: Record<string, string> = {}) {
  const q = query.trim().toLowerCase();
  // numbers match however they are typed ("0789 175 095" finds +256789175095)
  const qDigits = q.replace(/\D/g, '').replace(/^0+/, '');
  const matches = (hay: string) => hay.toLowerCase().includes(q) || (qDigits.length >= 3 && hay.replace(/\D/g, '').includes(qDigits));
  const kept = rows.filter((c) => {
    const p = prefs[c.conversation_id];
    const archived = !!p?.is_archived;
    const gone = deletedAt[c.conversation_id];
    if (gone && (!c.last_message_at || c.last_message_at <= gone)) return false;
    if (q && !matches(names[c.other_user_id] ?? '')) return false;
    switch (filter) {
      case 'archived': return archived;
      case 'unread': return !archived && isUnread(c, p);
      case 'favorites': return !!p?.is_favorite;
      case 'groups': return false; // group chats are not built yet
      default: return !archived;
    }
  });
  const pin = (c: ConversationSummary) => (prefs[c.conversation_id]?.is_pinned ? prefs[c.conversation_id]?.pinned_at ?? '1' : '');
  // stable sort: pinned first (newest pin on top), everything else keeps the server's newest-message order
  return kept.map((c, i) => ({ c, i })).sort((a, b) => (pin(b.c) > pin(a.c) ? 1 : pin(b.c) < pin(a.c) ? -1 : a.i - b.i)).map((x) => x.c);
}

/**
 * The chat list with WhatsApp filter pills, live updates and per-chat Favorite / Archive. `morePill` (desktop) puts
 * Archived behind a [+] pill; `selectedId` highlights the open chat.
 */
export default function ConversationList({ onOpen, query = '', selectedId = null, morePill = false, filter: controlled, onFilter }: {
  onOpen: (otherUserId: string) => void; query?: string; selectedId?: string | null; morePill?: boolean;
  filter?: ChatFilter; onFilter?: (f: ChatFilter) => void;
}) {
  const { user } = useAuth();
  const { show } = useToast();
  const [own, setOwn] = useState<ChatFilter>('all');
  const filter = controlled ?? own;
  const setFilter = onFilter ?? setOwn;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const device = useSyncExternalStore(subscribeChatPrefs, getChatPrefs, getChatPrefs);
  const contacts = useContacts();
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);
  const data = useAsync(async () => {
    const [rows, prefRows, blocked] = await Promise.all([
      api.listConversations(),
      user ? api.myConversationPrefs(user.id) : Promise.resolve([]),
      user ? Promise.resolve().then(() => api.myBlockedIds(user.id)).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ]);
    const people = await api.profilesByIds(rows.map((r) => r.other_user_id));
    const prefs: Prefs = Object.fromEntries(prefRows.map((p) => [p.conversation_id, {
      is_favorite: p.is_favorite, is_archived: p.is_archived, is_pinned: !!p.is_pinned, pinned_at: p.pinned_at ?? null, marked_unread: !!p.marked_unread,
    }]));
    return { rows, people, prefs, blocked };
  }, [], user ? memUserKey(user.id, 'inbox') : null); // message previews stay in memory only (vanish mode)
  const { reload } = data;
  // optimistic Favorite / Archive changes until the next reload confirms them
  const [local, setLocal] = useState<Prefs>({});

  const refresh = useCallback(() => { void reload(); }, [reload]);
  useEffect(() => {
    let t: number | undefined;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(refresh, 400); };
    const channel = supabase.channel(`inbox-${++channelCounter}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, soon).subscribe();
    const tick = window.setInterval(refresh, 30_000); // also drops vanished last-messages
    return () => { window.clearTimeout(t); window.clearInterval(tick); supabase.removeChannel(channel); };
  }, [refresh]);

  const prefs = useMemo<Prefs>(() => ({ ...(data.data?.prefs ?? {}), ...local }), [data.data, local]);
  // search matches the saved name, the number you know them by (any formatting) and their Pulse name
  const names = useMemo(() => {
    const ids = new Set([...Object.keys(data.data?.people ?? {}), ...Object.keys(contacts)]);
    return Object.fromEntries([...ids].map((id) => {
      const p = (data.data?.people ?? {})[id] as PublicProfile | undefined;
      const c = contacts[id];
      return [id, [c?.name, p?.display_name, c?.phone, c?.phone?.replace(/\D/g, '')].filter(Boolean).join(' ')];
    }));
  }, [data.data, contacts]);
  const rows = data.data?.rows ?? [];
  const shown = filterConversations(rows, prefs, filter, query, names, device.deletedAt);
  const count = (f: ChatFilter) => filterConversations(rows, prefs, f, '', {}, device.deletedAt).length;
  // chat context menu (⌄ / right-click / long-press) and the confirmations it opens
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'block' | 'clear' | 'delete'; c: ConversationSummary; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedLocal, setBlockedLocal] = useState<Record<string, boolean>>({});
  const isBlocked = (id: string) => blockedLocal[id] ?? (data.data?.blocked ?? []).includes(id);
  const press = useRef<number | undefined>(undefined);

  const setPref = async (c: ConversationSummary, patch: Partial<Pick<ConversationPrefs, 'is_favorite' | 'is_archived' | 'is_pinned' | 'marked_unread'>>, done: string) => {
    if (!user) return;
    const before = prefs[c.conversation_id] ?? { is_favorite: false, is_archived: false };
    setLocal((l) => ({ ...l, [c.conversation_id]: { ...before, ...patch } }));
    try {
      await api.setConversationPrefs(c.conversation_id, user.id, patch);
      show(done);
    } catch (e) {
      setLocal((l) => ({ ...l, [c.conversation_id]: before }));
      show(friendlyError(e), 'error');
    }
  };

  const runAction = async (c: ConversationSummary, name: string, a: ChatListAction) => {
    const pref = prefs[c.conversation_id];
    switch (a.kind) {
      case 'archive': return setPref(c, { is_archived: !pref?.is_archived }, pref?.is_archived ? 'Chat unarchived' : 'Chat archived');
      case 'mute': muteChat(c.conversation_id, a.ms); return show(a.ms === 'always' ? 'Chat muted' : 'Chat muted for a while');
      case 'unmute': unmuteChat(c.conversation_id); return show('Chat unmuted');
      case 'pin': return setPref(c, { is_pinned: !pref?.is_pinned }, pref?.is_pinned ? 'Chat unpinned' : 'Chat pinned');
      case 'unread': return setPref(c, { marked_unread: true }, 'Marked as unread');
      case 'read':
        await api.markConversationRead(c.conversation_id).catch(() => undefined);
        if (pref?.marked_unread) await setPref(c, { marked_unread: false }, 'Marked as read');
        else { show('Marked as read'); refresh(); }
        return;
      case 'favorite': return setPref(c, { is_favorite: !pref?.is_favorite }, pref?.is_favorite ? 'Removed from favorites' : 'Added to favorites');
      case 'block': case 'clear': case 'delete': return setConfirm({ kind: a.kind, c, name });
    }
  };

  const confirmAction = async () => {
    if (!confirm || !user) return;
    const { kind, c, name } = confirm;
    if (kind === 'clear') { clearChat(c.conversation_id); show('Chat cleared'); setConfirm(null); return; }
    if (kind === 'delete') { deleteChat(c.conversation_id); show('Chat deleted'); setConfirm(null); return; }
    const next = !isBlocked(c.other_user_id);
    setBusy(true);
    try {
      await api.setBlocked(user.id, c.other_user_id, next);
      setBlockedLocal((b) => ({ ...b, [c.other_user_id]: next }));
      show(next ? `${name} blocked` : `${name} unblocked`);
      setConfirm(null);
    } catch (e) {
      show(friendlyError(e), 'error');
    }
    setBusy(false);
  };

  const preview = (c: ConversationSummary) => {
    if (!c.last_body) return 'No messages yet';
    const who = c.last_sender_id === user?.id ? 'You: ' : '';
    return c.last_kind === 'system' ? c.last_body : who + c.last_body;
  };

  const empty: Record<ChatFilter, { title: string; hint: string }> = {
    all: { title: 'No conversations yet', hint: "Tap someone's name on a post or status, then press Message. Or start one by phone number." },
    unread: { title: 'No unread chats', hint: 'You are all caught up.' },
    favorites: { title: 'No favorites yet', hint: 'Tap the star on a chat to keep it here.' },
    groups: { title: 'Group chats are coming soon', hint: 'For now, use Communities and venue Channels to talk with many people.' },
    archived: { title: 'No archived chats', hint: 'Archive a chat to hide it from All. New messages keep it archived.' },
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className={`flex gap-2 px-3 py-2 whitespace-nowrap ${morePill ? '' : 'overflow-x-auto scrollbar-hide'}`} role="tablist" aria-label="Filter chats">
        {FILTERS.filter((f) => !morePill || f.id !== 'archived' || filter === 'archived').map((f) => {
          const on = filter === f.id;
          const n = f.id === 'unread' || f.id === 'archived' ? count(f.id) : 0;
          return (
            <button key={f.id} role="tab" aria-selected={on} onClick={() => setFilter(f.id)}
              className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                on ? 'bg-wa-green/20 text-wa-green dark:bg-wa-green/25' : 'bg-wa-lightSecondary dark:bg-wa-darkSecondary text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green'
              }`}>
              {f.label}{n > 0 && <span className="ml-1">{n}</span>}
            </button>
          );
        })}
        {morePill && (
          <div ref={moreRef} className="relative">
            <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-label="More chat filters" aria-haspopup="menu" aria-expanded={moreOpen}
              className="flex-shrink-0 rounded-full px-2.5 py-1.5 text-xs font-semibold bg-wa-lightSecondary dark:bg-wa-darkSecondary text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green">
              <Plus className="w-3.5 h-3.5" />
            </button>
            {moreOpen && (
              <div role="menu" className="absolute left-0 top-full mt-1 z-20 min-w-44 rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel shadow-xl py-1">
                <button type="button" role="menuitem" onClick={() => { setFilter('archived'); setMoreOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary ${bodyText}`}>
                  <Archive className="w-4 h-4" />Archived{count('archived') > 0 && <span className={`ml-auto text-xs ${mutedText}`}>{count('archived')}</span>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-y-contain">
        {data.loading && !data.data ? (
          <div className="px-4"><ListSkeleton label="Loading conversations" /></div>
        ) : data.error ? (
          <div className="p-4"><ErrorNote message={data.error} /></div>
        ) : shown.length === 0 ? (
          <div className="text-center px-8 py-14">
            {filter === 'groups' ? <Users className="w-12 h-12 text-wa-quiet mx-auto mb-3" /> : <MessageCircle className="w-12 h-12 text-wa-quiet mx-auto mb-3" />}
            <p className={`text-sm font-medium ${bodyText}`}>{query ? 'No chat matches.' : empty[filter].title}</p>
            {!query && <p className={`text-xs mt-1 ${mutedText}`}>{empty[filter].hint}</p>}
          </div>
        ) : (
          <ul className="divide-y divide-wa-lightBorder dark:divide-wa-darkBorder" aria-label="Chats">
            {shown.map((c) => {
              const p: PublicProfile | undefined = data.data!.people[c.other_user_id];
              const pref = prefs[c.conversation_id];
              const name = contactLabel(contacts[c.other_user_id], p?.display_name).title;
              const open = selectedId === c.other_user_id;
              const muted = isMutedIn(device, c.conversation_id);
              const unread = isUnread(c, pref);
              const mineLast = c.last_sender_id === user?.id && c.last_kind === 'text';
              return (
                <li key={c.conversation_id}
                  onContextMenu={(e) => { e.preventDefault(); setMenuFor(c.conversation_id); }}
                  onTouchStart={() => { press.current = window.setTimeout(() => setMenuFor(c.conversation_id), LONG_PRESS_MS); }}
                  onTouchEnd={() => window.clearTimeout(press.current)} onTouchMove={() => window.clearTimeout(press.current)}
                  className={`group relative flex items-center transition-colors ${open ? 'bg-wa-lightSecondary dark:bg-wa-darkSecondary' : 'hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60'}`}>
                  <button onClick={() => onOpen(c.other_user_id)} aria-current={open ? 'true' : undefined} className="flex items-center gap-3 flex-1 min-w-0 pl-4 py-3 text-left">
                    <Avatar name={contacts[c.other_user_id]?.name ?? p?.display_name ?? '?'} url={p?.avatar_url} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold truncate ${bodyText}`}>{name}</span>
                        {pref?.is_favorite && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 flex-shrink-0" aria-label="Favorite" />}
                        {c.vanish_mode && <Ghost className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" aria-label="Secret mode on" />}
                        <span className={`ml-auto text-[11px] flex-shrink-0 ${unread ? 'text-wa-green font-semibold' : mutedText}`}>{chatListTime(c.last_message_at)}</span>
                      </span>
                      <span className={`flex items-center gap-2 text-xs mt-0.5 ${unread ? `font-semibold ${bodyText}` : mutedText}`}>
                        {mineLast && <CheckCheck className="w-4 h-4 flex-shrink-0 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary" aria-label="Sent" />}
                        <span className="truncate flex-1">
                          {c.last_vanish && c.last_kind === 'text' && '👻 '}<EmojiText text={mineLast ? (c.last_body ?? '') : preview(c)} />
                        </span>
                        {muted && <BellOff className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} aria-label="Muted" />}
                        {pref?.is_pinned && <Pin className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} aria-label="Pinned" />}
                        {c.unread_count > 0 ? (
                          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-wa-green text-white text-[11px] font-bold flex items-center justify-center">{c.unread_count}</span>
                        ) : pref?.marked_unread && <span className="w-3 h-3 rounded-full bg-wa-green flex-shrink-0" aria-label="Marked as unread" />}
                      </span>
                    </span>
                  </button>
                  <span className="flex items-center pr-2 pl-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                    <button onClick={() => setMenuFor(menuFor === c.conversation_id ? null : c.conversation_id)}
                      aria-label={`Chat options for ${name}`} aria-haspopup="menu" aria-expanded={menuFor === c.conversation_id}
                      className={`p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${mutedText}`}>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </span>
                  {menuFor === c.conversation_id && (
                    <ChatListMenu archived={!!pref?.is_archived} muted={muted} pinned={!!pref?.is_pinned} unread={unread} favorite={!!pref?.is_favorite}
                      blocked={isBlocked(c.other_user_id)} onClose={() => setMenuFor(null)} onAction={(a) => { void runAction(c, name, a); }} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirm && (
        <Modal title={confirm.kind === 'block' ? `${isBlocked(confirm.c.other_user_id) ? 'Unblock' : 'Block'} ${confirm.name}?` : confirm.kind === 'clear' ? 'Clear this chat?' : 'Delete this chat?'}
          onClose={() => setConfirm(null)}>
          <p className={`text-sm ${mutedText}`}>
            {confirm.kind === 'block'
              ? isBlocked(confirm.c.other_user_id)
                ? `${confirm.name} will be able to message you again.`
                : `Neither of you can message the other until you unblock. ${confirm.name} is not told; their messages just do not go through.`
              : confirm.kind === 'clear'
                ? `Messages disappear from this device only; ${confirm.name} still has them.`
                : `The chat leaves your list on this device until a new message arrives; ${confirm.name} still has the messages.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} className="px-4 py-2 rounded-full text-sm font-semibold text-wa-green hover:bg-wa-green/10">Cancel</button>
            <button type="button" onClick={confirmAction} disabled={busy}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-wa-live text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {confirm.kind === 'block' ? (isBlocked(confirm.c.other_user_id) ? 'Unblock' : 'Block') : confirm.kind === 'clear' ? 'Clear chat' : 'Delete chat'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
