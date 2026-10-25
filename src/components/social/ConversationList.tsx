import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Ghost, MessageCircle, Star, Archive, ArchiveRestore, Users, CheckCheck, BellOff, Plus } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { ListSkeleton } from '@/components/Skeleton';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { chatListTime } from '@/lib/time';
import { getChatPrefs, subscribeChatPrefs } from '@/lib/chatPrefs';
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
type Prefs = Record<string, Pick<ConversationPrefs, 'is_favorite' | 'is_archived'>>;

/** Pure filter, exported for tests. Archived chats only show under Archived (WhatsApp behaviour). */
// eslint-disable-next-line react-refresh/only-export-components
export function filterConversations(rows: ConversationSummary[], prefs: Prefs, filter: ChatFilter, query = '', names: Record<string, string> = {}) {
  const q = query.trim().toLowerCase();
  // numbers match however they are typed ("0789 175 095" finds +256789175095)
  const qDigits = q.replace(/\D/g, '').replace(/^0+/, '');
  const matches = (hay: string) => hay.toLowerCase().includes(q) || (qDigits.length >= 3 && hay.replace(/\D/g, '').includes(qDigits));
  return rows.filter((c) => {
    const p = prefs[c.conversation_id];
    const archived = !!p?.is_archived;
    if (q && !matches(names[c.other_user_id] ?? '')) return false;
    switch (filter) {
      case 'archived': return archived;
      case 'unread': return !archived && c.unread_count > 0;
      case 'favorites': return !!p?.is_favorite;
      case 'groups': return false; // group chats are not built yet
      default: return !archived;
    }
  });
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
    const [rows, prefRows] = await Promise.all([api.listConversations(), user ? api.myConversationPrefs(user.id) : Promise.resolve([])]);
    const people = await api.profilesByIds(rows.map((r) => r.other_user_id));
    const prefs: Prefs = Object.fromEntries(prefRows.map((p) => [p.conversation_id, { is_favorite: p.is_favorite, is_archived: p.is_archived }]));
    return { rows, people, prefs };
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
  const shown = filterConversations(rows, prefs, filter, query, names);
  const count = (f: ChatFilter) => filterConversations(rows, prefs, f).length;

  const setPref = async (c: ConversationSummary, patch: Partial<Pick<ConversationPrefs, 'is_favorite' | 'is_archived'>>, done: string) => {
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
              const muted = device.muted.includes(c.conversation_id);
              const mineLast = c.last_sender_id === user?.id && c.last_kind === 'text';
              return (
                <li key={c.conversation_id} className={`group flex items-center transition-colors ${open ? 'bg-wa-lightSecondary dark:bg-wa-darkSecondary' : 'hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60'}`}>
                  <button onClick={() => onOpen(c.other_user_id)} aria-current={open ? 'true' : undefined} className="flex items-center gap-3 flex-1 min-w-0 pl-4 py-3 text-left">
                    <Avatar name={contacts[c.other_user_id]?.name ?? p?.display_name ?? '?'} url={p?.avatar_url} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold truncate ${bodyText}`}>{name}</span>
                        {pref?.is_favorite && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 flex-shrink-0" aria-label="Favorite" />}
                        {c.vanish_mode && <Ghost className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" aria-label="Secret mode on" />}
                        <span className={`ml-auto text-[11px] flex-shrink-0 ${c.unread_count > 0 ? 'text-wa-green font-semibold' : mutedText}`}>{chatListTime(c.last_message_at)}</span>
                      </span>
                      <span className={`flex items-center gap-2 text-xs mt-0.5 ${c.unread_count > 0 ? `font-semibold ${bodyText}` : mutedText}`}>
                        {mineLast && <CheckCheck className="w-4 h-4 flex-shrink-0 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary" aria-label="Sent" />}
                        <span className="truncate flex-1">
                          {c.last_vanish && c.last_kind === 'text' && '👻 '}<EmojiText text={mineLast ? (c.last_body ?? '') : preview(c)} />
                        </span>
                        {muted && <BellOff className={`w-3.5 h-3.5 flex-shrink-0 ${mutedText}`} aria-label="Muted" />}
                        {c.unread_count > 0 && (
                          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-wa-green text-white text-[11px] font-bold flex items-center justify-center">{c.unread_count}</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <span className="flex items-center gap-0.5 pr-2 pl-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() => setPref(c, { is_favorite: !pref?.is_favorite }, pref?.is_favorite ? 'Removed from favorites' : 'Added to favorites')}
                      aria-label={pref?.is_favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
                      aria-pressed={!!pref?.is_favorite}
                      className={`p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${pref?.is_favorite ? 'text-amber-400' : mutedText}`}
                    >
                      <Star className={`w-4 h-4 ${pref?.is_favorite ? 'fill-amber-400' : ''}`} />
                    </button>
                    <button
                      onClick={() => setPref(c, { is_archived: !pref?.is_archived }, pref?.is_archived ? 'Chat unarchived' : 'Chat archived')}
                      aria-label={pref?.is_archived ? `Unarchive ${name}` : `Archive ${name}`}
                      className={`p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${mutedText}`}
                    >
                      {pref?.is_archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
