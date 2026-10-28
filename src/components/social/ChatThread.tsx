import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeft, X, Send, Loader2, Search, Pin, Video, Phone, EllipsisVertical, Paperclip, Star, Copy, Trash2, Check, Forward } from 'lucide-react';
import Avatar from '@/components/Avatar';
import ChatShell from '@/components/social/ChatShell';
import RefPreview from '@/components/social/RefPreview';
import ReportModal from '@/components/community/ReportModal';
import MessageBubble, { messagePreview, messageText } from '@/components/social/chat/MessageBubble';
import { DeleteMessageModal, ForwardModal, MessageInfoModal, ReplyBar, type MessageAction } from '@/components/social/chat/MessageActions';
import ChatHeaderMenu, { ConfirmChatModal, type ChatHeaderAction } from '@/components/social/chat/ChatHeaderMenu';
import { useMessageExtras } from '@/hooks/useMessageExtras';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { useEmojiInsert } from '@/components/emoji/useEmojiInsert';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { withTimeout } from '@/lib/withTimeout';
import { chatDayLabel, dayKey } from '@/lib/time';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { useVoiceComposer } from '@/components/social/VoiceComposer';
import type { VoiceRecording } from '@/hooks/useVoiceRecorder';
import type { ChatMessage, MessageRef, PublicProfile } from '@/lib/types';
import { ChatSkeleton } from '@/components/Skeleton';
import { CHAT_THEMES, NO_CALLS, NO_LISTS, clearChat, deleteChat, getChatPrefs, isMutedIn, muteChat, setChatTheme, subscribeChatPrefs, unmuteChat } from '@/lib/chatPrefs';
import { exportChat } from '@/lib/exportChat';
import { useChatActivity, useChatActivitySender } from '@/lib/chatActivity';
import { appendToContactNote, contactLabel, useContacts } from '@/lib/contacts';
import { FIRST_PAGE, chatKey, loadChat, seedChat } from '@/lib/chatCache';
import { writeCache } from '@/lib/cache';

let channelCounter = 0;
const MAX = 2000;
const VOICE_BODY = '🎤 Voice message';
/** The send button never spins longer than this; the request may still land (Realtime then shows it). */
const SEND_TIMEOUT_MS = 15_000;
/** Older history comes in pages of this size (the first screen is FIRST_PAGE). */
const OLDER_PAGE = 50;
/** WhatsApp's floating date / info pill. */
const PILL = 'bg-white/90 dark:bg-zinc-800/90 shadow-sm rounded-full px-3 py-1 text-xs text-gray-600 dark:text-zinc-300';
const SEND_TIMEOUT_TEXT = 'Sending is taking too long. Check your connection; the message may still arrive, so look before sending it again.';

const isLive = (m: ChatMessage, now: number) => !m.expires_at || new Date(m.expires_at).getTime() > now;
const byTime = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
/** Countdown starts when the other person has read the message (unread ones only carry the 24 h fallback). */
const secondsLeft = (m: ChatMessage, now: number) => (m.expires_at && m.read_at ? Math.max(0, Math.ceil((new Date(m.expires_at).getTime() - now) / 1000)) : null);
/** Fold the latest page from the server into what is on screen: everything inside the fresh window comes from the server;
 *  older pages loaded on demand stay, and so do messages we just sent that the server has not returned yet. */
function mergeFresh(list: ChatMessage[], rows: ChatMessage[]) {
  const fresh = new Map(rows.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const oldestFresh = rows.length >= FIRST_PAGE ? rows[0].created_at : '';
  const merged = [...list.filter((m) => !fresh.has(m.id) && ((oldestFresh && m.created_at < oldestFresh) || Date.now() - new Date(m.created_at).getTime() < 15_000)), ...rows];
  return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort(byTime);
}

/** One private conversation with live updates and Secret (vanish) mode. */
/** What the desktop Contact info drawer needs from the open chat. */
export type ChatMeta = { conversationId: string; vanish: boolean; other: PublicProfile | null; toggleVanish: () => void };

/** The chat as a column of the desktop layout instead of an overlay. */
function EmbeddedShell({ label, secret, children }: { label: string; secret: boolean; onClose?: () => void; children: ReactNode }) {
  return (
    <section aria-label={label} className={`flex flex-col h-full min-h-0 min-w-0 ${secret ? 'bg-zinc-950 text-zinc-100' : 'bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText'}`}
      style={{ paddingBottom: 'var(--emoji-sheet, 0px)' }}>
      {children}
    </section>
  );
}

export default function ChatThread({ otherUserId, initialRef, onBack, onClose, embedded = false, onInfo, search = null, onSearch, onMeta }: {
  otherUserId: string; initialRef: MessageRef | null; onBack: () => void; onClose: () => void;
  /** Desktop: render as a column; the header opens Contact info (onInfo) instead of the profile card. */
  embedded?: boolean; onInfo?: () => void;
  /** Search inside this chat: null = closed. */
  search?: string | null; onSearch?: (q: string | null) => void;
  onMeta?: (meta: ChatMeta) => void;
}) {
  const { user } = useAuth();
  const { show } = useToast();
  const { refreshUnread, openProfile } = useSocial();
  const [menuOpen, setMenuOpen] = useState(false);
  const noCalls = () => show(NO_CALLS);
  const { openQuickSnap } = useQuickSnap();
  const me = user?.id ?? '';
  // paint at once from what the app already knows (an earlier visit, a prefetch, or the inbox row); the network refreshes it
  const [seed] = useState(() => (me ? seedChat(me, otherUserId) : null));
  const [convId, setConvId] = useState<string | null>(seed?.convId ?? null);
  const [other, setOther] = useState<PublicProfile | null>(seed?.other ?? null);
  const [vanish, setVanish] = useState(seed?.vanish ?? false);
  const [messages, setMessages] = useState<ChatMessage[]>(seed?.messages ?? []);
  const [loading, setLoading] = useState(!seed?.messages);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [ref, setRef] = useState<MessageRef | null>(initialRef);
  const [now, setNow] = useState(() => Date.now());
  // message actions (migration 19)
  const [pinnedId, setPinnedId] = useState<string | null>(seed?.pinnedId ?? null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage[] | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(seed?.blocked ?? false);
  const [favorite, setFavorite] = useState(seed?.favorite ?? false);
  const [confirm, setConfirm] = useState<'block' | 'clear' | 'delete' | null>(null);
  const [reportingUser, setReportingUser] = useState(false);
  // "Select messages": ids picked, or null when not selecting
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // older history (paged) and the floating day badge
  const [hasOlder, setHasOlder] = useState(seed?.hasOlder ?? false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const keepScroll = useRef<{ height: number; top: number } | null>(null);
  const [stickyDay, setStickyDay] = useState<string | null>(null);
  const [stickyShown, setStickyShown] = useState(false);
  const stickyTimer = useRef<number | undefined>(undefined);
  const readTimer = useRef<number | undefined>(undefined);
  const convRef = useRef<string | null>(seed?.convId ?? null);
  const insertEmoji = useEmojiInsert(inputRef, text, setText, MAX);

  // 1. find or create the conversation, and who we are talking to (a known conversation skips the round trip;
  //    the profile is still refreshed in the background)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [id, people] = await Promise.all([seed?.convId ?? api.startConversation(otherUserId), api.profilesByIds([otherUserId])]);
        if (!alive) return;
        setOther((o) => people[otherUserId] ?? o);
        convRef.current = id;
        setConvId(id);
      } catch (e) {
        if (!alive || seed?.convId) return; // already showing the chat: keep it
        setError(friendlyError(e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [otherUserId, seed]);

  /** Re-read the history (picks up read receipts and vanish times even if a Realtime event was missed). */
  const syncMessages = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    try {
      const rows = await api.listMessages(id, FIRST_PAGE);
      setMessages((list) => mergeFresh(list, rows));
    } catch { /* keep what is on screen */ }
  }, []);

  const markRead = useCallback(() => {
    const id = convRef.current;
    if (!id || document.visibilityState === 'hidden') return;
    api.markConversationRead(id)
      .then((n) => {
        refreshUnread();
        // reading starts the vanish countdown on the server: fetch the new expiry times
        if (n > 0) void syncMessages();
      })
      .catch(() => undefined);
  }, [refreshUnread, syncMessages]);
  const markReadSoon = useCallback(() => {
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(markRead, 300);
  }, [markRead]);

  // 2. load history + subscribe to live changes
  useEffect(() => {
    if (!convId) return;
    let alive = true;
    const upsert = (m: ChatMessage) => setMessages((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (i === -1) return [...list, m].sort(byTime);
      const next = list.slice();
      next[i] = { ...next[i], ...m };
      return next;
    });

    // shares the request with a prefetch from the chat list that is still running
    const shown = !!seed?.messages;
    loadChat(me, otherUserId, convId, other)
      .then((snap) => {
        if (!alive) return;
        // a chat painted from the cache keeps its older pages and scroll place
        setMessages((list) => (shown ? mergeFresh(list, snap.messages) : snap.messages));
        if (!shown) setHasOlder(snap.hasOlder);
        setVanish(snap.vanish);
        setPinnedId(snap.pinnedId);
        setLoading(false);
        markRead();
        // opening the chat undoes "Mark as unread" (no-op before migration 20)
        // best effort: neither may break loading the chat
        if (me) Promise.resolve().then(() => api.setConversationPrefs(convId, me, { marked_unread: false })).catch(() => undefined);
        if (me) Promise.resolve().then(() => api.myBlockedIds(me)).then((ids) => { if (alive) setBlocked(ids.includes(otherUserId)); }).catch(() => undefined);
        if (me) Promise.resolve().then(() => api.myConversationPrefs(me)).then((rows) => { if (alive) setFavorite(!!rows.find((r) => r.conversation_id === convId)?.is_favorite); }).catch(() => undefined);
      })
      .catch((e) => { if (alive && !shown) { setError(friendlyError(e)); setLoading(false); } });

    const channel = supabase
      .channel(`chat-${convId}-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => {
        const m = payload.new as ChatMessage;
        upsert(m);
        if (m.sender_id !== me) markReadSoon();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => upsert(payload.new as ChatMessage))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${convId}` }, (payload) => {
        const c = payload.new as { vanish_mode?: boolean; pinned_message_id?: string | null };
        setVanish(!!c.vanish_mode);
        if ('pinned_message_id' in c) setPinnedId(c.pinned_message_id ?? null);
      })
      .subscribe();

    const onVisible = () => { if (document.visibilityState === 'visible') { markRead(); void syncMessages(); } };
    document.addEventListener('visibilitychange', onVisible);
    const resync = window.setInterval(() => { if (document.visibilityState === 'visible') void syncMessages(); }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(resync);
      window.clearTimeout(readTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
    // `other` and `seed` only feed the first paint: leaving them out keeps the subscription from restarting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, me, otherUserId, markRead, markReadSoon, syncMessages]);

  // keep the snapshot current so the next open of this chat paints instantly
  useEffect(() => {
    if (!me || !convId || loading || error) return;
    writeCache(chatKey(me, otherUserId), { convId, other, messages, hasOlder, vanish, pinnedId });
  }, [me, otherUserId, convId, other, messages, hasOlder, vanish, pinnedId, loading, error]);

  // 3. vanish countdown: only runs while something is counting down
  const counting = useMemo(() => messages.some((m) => m.expires_at && m.read_at), [messages]);
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now()); // the clock was idle until now: sync it before the first tick so the number shown is right
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  // this device's chat theme and "clear chat" moment
  const device = useSyncExternalStore(subscribeChatPrefs, getChatPrefs, getChatPrefs);
  const clearedAt = convId ? device.clearedAt[convId] ?? null : null;
  const themeClass = CHAT_THEMES.find((t) => t.id === (convId ? device.themes[convId] : undefined))?.className ?? '';
  const q = search?.trim().toLowerCase() ?? '';
  const messageIds = useMemo(() => messages.filter((m) => m.kind !== 'system').map((m) => m.id), [messages]);
  const extras = useMessageExtras(messageIds, me);
  const visible = useMemo(
    () => messages.filter((m) => isLive(m, now) && !extras.hidden.has(m.id) && (!clearedAt || m.created_at > clearedAt) && (!q || m.body.toLowerCase().includes(q))),
    [messages, now, clearedAt, q, extras.hidden],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // follow the newest message (not when older history is added at the top)
  const lastVisibleId = visible[visible.length - 1]?.id;
  // (before paint, so a chat opened from the cache never flashes its oldest messages first)
  useLayoutEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [lastVisibleId, loading]);

  /** Load the page of history before the oldest message on screen, keeping the reader's place. */
  const loadOlder = useCallback(async () => {
    const id = convRef.current;
    const oldest = messages[0];
    if (!id || !oldest || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const rows = await api.listMessages(id, OLDER_PAGE, oldest.created_at);
      const el = listRef.current;
      if (el) keepScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((list) => {
        const have = new Set(list.map((m) => m.id));
        return [...rows.filter((m) => !have.has(m.id)), ...list].sort(byTime);
      });
      setHasOlder(rows.length >= OLDER_PAGE);
    } catch (err) {
      show(friendlyError(err), 'error');
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, hasOlder, show]);

  // after older messages are added above, stay on the same message instead of jumping
  useLayoutEffect(() => {
    const el = listRef.current;
    const kept = keepScroll.current;
    if (!el || !kept) return;
    el.scrollTop = el.scrollHeight - kept.height + kept.top;
    keepScroll.current = null;
  }, [messages]);

  /** Floating day badge: the day of the messages at the top of the view; fades out shortly after scrolling stops. */
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let label: string | null = null;
    for (const sep of el.querySelectorAll<HTMLElement>('[data-day-label]')) {
      if (sep.getBoundingClientRect().top - top <= 40) label = sep.dataset.dayLabel ?? null;
      else break;
    }
    label = label ?? el.querySelector<HTMLElement>('[data-day-label]')?.dataset.dayLabel ?? null;
    setStickyDay(label);
    setStickyShown(true);
    window.clearTimeout(stickyTimer.current);
    stickyTimer.current = window.setTimeout(() => setStickyShown(false), 1500);
    if (el.scrollTop < 80) void loadOlder();
  };
  useEffect(() => () => window.clearTimeout(stickyTimer.current), []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !convId || sending) return;
    setSending(true);
    try {
      const m = await withTimeout(api.sendMessage(convId, body, ref, null, { replyToId: replyTo?.id ?? null }), SEND_TIMEOUT_MS, SEND_TIMEOUT_TEXT);
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort(byTime)));
      setText('');
      activity.stopped();
      setRef(null);
      setReplyTo(null);
    } catch (err) {
      // the text stays in the box so nothing is lost; the console keeps the full database error
      console.error('[pulse] message failed to send', err);
      show(friendlyError(err), 'error');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const sendVoice = useCallback(async (rec: VoiceRecording) => {
    const id = convRef.current;
    if (!id || !me) return;
    const url = await withTimeout(api.uploadVoiceNote(id, me, rec.blob, rec.ext), 60_000, 'Uploading the voice message is taking too long. Check your connection and try again.');
    const m = await withTimeout(api.sendMessage(id, VOICE_BODY, null, {
      media_url: url, media_type: 'audio', media_duration_ms: rec.durationMs, media_waveform: rec.waveform,
    }), SEND_TIMEOUT_MS, SEND_TIMEOUT_TEXT);
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort(byTime)));
  }, [me]);
  const voice = useVoiceComposer({ disabled: !convId, secret: vanish, onSend: sendVoice });
  // live "typing…" / "recording audio…": ours goes out, theirs shows under the name
  const activity = useChatActivitySender(convId, me || null, voice.recording, !blocked);
  const theirActivity = useChatActivity(convId, me || null);

  const toggleVanish = async () => {
    if (!convId) return;
    const next = !vanish;
    setVanish(next);
    try {
      await api.setVanishMode(convId, next);
    } catch (err) {
      setVanish(!next);
      show(friendlyError(err), 'error');
    }
  };

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  }, []);

  const togglePin = async (m: ChatMessage) => {
    if (!convId) return;
    const before = pinnedId;
    const next = pinnedId === m.id ? null : m.id;
    setPinnedId(next);
    try {
      await api.setPinnedMessage(convId, next);
      show(next ? 'Message pinned' : 'Message unpinned');
    } catch (err) {
      setPinnedId(before);
      show(friendlyError(err), 'error');
    }
  };

  const onAction = (m: ChatMessage, a: MessageAction) => {
    switch (a) {
      case 'info': setInfoFor(m); break;
      case 'reply': setReplyTo(m); inputRef.current?.focus(); break;
      case 'copy':
        void navigator.clipboard?.writeText(messageText(m)).then(() => show('Message copied'), () => show('Could not copy. Select the text instead.', 'error'));
        break;
      case 'forward': setForwarding([m]); break;
      case 'select': setSelected(new Set([m.id])); break;
      case 'pin': void togglePin(m); break;
      case 'star': void extras.toggleStar(m.id); break;
      case 'note': appendToContactNote(otherUserId, messageText(m)); show('Added to your note about this contact'); break;
      case 'report': setReporting(m); break;
      case 'delete': setDeleting(m); break;
      default: break;
    }
  };

  const secret = vanish;

  // "Select messages": pick bubbles, then star, copy or delete them for yourself in one go
  const toggleSelected = (id: string) => setSelected((s) => {
    if (!s) return s;
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const pickedInOrder = () => visible.filter((m) => selected?.has(m.id));
  const copySelected = () => {
    const picked = pickedInOrder();
    const out = picked.length === 1 ? messageText(picked[0])
      : picked.map((m) => `[${new Date(m.created_at).toLocaleString()}] ${m.sender_id === me ? 'You' : label.title}: ${messageText(m)}`).join('\n');
    void navigator.clipboard?.writeText(out).then(
      () => { show(picked.length === 1 ? 'Message copied' : `${picked.length} messages copied`); setSelected(null); },
      () => show('Could not copy. Select the text instead.', 'error'));
  };
  const forwardSelected = () => {
    const picked = pickedInOrder();
    const ok = picked.filter((m) => m.media_type !== 'audio');
    if (!ok.length) { show('Voice messages cannot be forwarded.', 'error'); return; }
    if (ok.length < picked.length) show('Voice messages are left out: they stay in the chat they were recorded for.');
    setForwarding(ok);
  };
  // Escape leaves selection, like WhatsApp Web
  const selecting = selected !== null;
  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [selecting]);
  const starSelected = async () => {
    const ids = pickedInOrder().map((m) => m.id);
    // like WhatsApp: star them all, or unstar them all when every one is already starred
    const on = !ids.every((id) => extras.starred.has(id));
    try {
      await Promise.all(ids.filter((id) => extras.starred.has(id) !== on).map((id) => api.setMessageStar(id, me, on)));
      show(`${ids.length} message${ids.length === 1 ? '' : 's'} ${on ? 'starred' : 'unstarred'}`);
      setSelected(null);
    } catch (e) { show(friendlyError(e), 'error'); }
    void extras.reload();
  };

  // the header's ⋮ menu
  const onMenu = async (a: ChatHeaderAction) => {
    switch (a.kind) {
      case 'info': return onInfo ? onInfo() : openProfile(otherUserId);
      case 'close': return onClose();
      case 'report': return setReportingUser(true);
      case 'block': case 'clear': case 'delete': return setConfirm(a.kind);
      case 'select': return setSelected(new Set());
      case 'list': return show(NO_LISTS);
      case 'callLink': case 'groupCall': return noCalls();
    }
    if (!convId) return;
    switch (a.kind) {
      case 'mute': muteChat(convId, a.ms); return show(a.ms === 'always' ? 'Chat muted' : 'Chat muted for a while');
      case 'unmute': unmuteChat(convId); return show('Chat unmuted');
      case 'vanish': return toggleVanish();
      case 'theme': return setChatTheme(convId, a.theme);
      case 'favorite': {
        const on = !favorite;
        setFavorite(on);
        try {
          await api.setConversationPrefs(convId, me, { is_favorite: on });
          show(on ? 'Added to favorites' : 'Removed from favorites');
        } catch (e) { setFavorite(!on); show(friendlyError(e), 'error'); }
        return;
      }
      case 'export':
        try { await exportChat(convId, label.title, me, device.clearedAt[convId]); show('Chat exported'); } catch (e) { show(friendlyError(e), 'error'); }
    }
  };
  const sub = secret ? 'text-zinc-400' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary';

  const toggleRef = useRef(toggleVanish);
  toggleRef.current = toggleVanish;
  useEffect(() => {
    if (convId) onMeta?.({ conversationId: convId, vanish, other, toggleVanish: () => { void toggleRef.current(); } });
  }, [convId, vanish, other, onMeta]);

  // your saved name for them, else the number you reached them on, else their Pulse name
  const contacts = useContacts();
  const label = contactLabel(contacts[otherUserId], other?.display_name);
  const Shell = embedded ? EmbeddedShell : ChatShell;
  return (
    <Shell label={`Chat with ${label.title}`} onClose={onClose} secret={secret}>
      {selected ? (
        <header className={`flex items-center gap-2 px-2 py-2.5 border-b ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`} data-testid="select-bar">
          <button onClick={() => setSelected(null)} aria-label="Cancel selection" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
          <span className="flex-1 text-[15px] font-medium" aria-live="polite">{selected.size ? `${selected.size} selected` : 'Select messages'}</span>
          <button onClick={() => void starSelected()} disabled={!selected.size} aria-label="Star selected messages" title="Star"
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40"><Star className="w-5 h-5" /></button>
          <button onClick={copySelected} disabled={!selected.size} aria-label="Copy selected messages" title="Copy"
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40"><Copy className="w-5 h-5" /></button>
          <button onClick={() => setDeletingSelected(true)} disabled={!selected.size} aria-label="Delete selected messages" title="Delete"
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40"><Trash2 className="w-5 h-5" /></button>
          <button onClick={forwardSelected} disabled={!selected.size} aria-label="Forward selected messages" title="Forward"
            className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40"><Forward className="w-5 h-5" /></button>
        </header>
      ) : (
      <header className={`flex items-center gap-2 px-2 py-2.5 border-b ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`}>
        {!embedded && <button onClick={onBack} aria-label="Back to messages" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>}
        <button onClick={() => (onInfo ? onInfo() : openProfile(otherUserId))} aria-label={onInfo ? `Contact info for ${label.title}` : undefined}
          className={`flex items-center gap-2.5 min-w-0 flex-1 text-left ${embedded ? 'pl-2' : ''}`}>
          <Avatar name={contacts[otherUserId]?.name ?? other?.display_name ?? '?'} url={other?.avatar_url} size={36} />
          <span className="min-w-0">
            <span className="block text-[15px] font-medium truncate">{label.title}</span>
            {/* the live status fades in over the usual subtitle and back out, like WhatsApp */}
            <span className="grid text-[11px]" aria-live="polite">
              <span className={`[grid-area:1/1] truncate transition-opacity duration-300 ${sub} ${theirActivity ? 'opacity-0' : 'opacity-100'}`} aria-hidden={!!theirActivity}>
                {secret ? 'Secret mode: messages vanish after being read' : label.subtitle ?? (onInfo ? 'Click here for contact info' : 'Private chat')}
              </span>
              <span className={`[grid-area:1/1] truncate transition-opacity duration-300 text-wa-green ${theirActivity ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!theirActivity}>
                {theirActivity === 'recording' ? 'recording audio…' : 'typing…'}
              </span>
            </span>
          </span>
        </button>
        <button onClick={noCalls} aria-label="Video call" title="Video call" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><Video className="w-5 h-5" /></button>
        <button onClick={noCalls} aria-label="Voice call" title="Voice call" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><Phone className="w-5 h-5" /></button>
        {onSearch && (
          <button onClick={() => onSearch(search === null ? '' : null)} aria-pressed={search !== null} aria-label="Search in this chat" title="Search"
            className={`p-2 rounded-full transition-colors ${search !== null ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}>
            <Search className="w-5 h-5" />
          </button>
        )}
        <span className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen} title="Menu"
            className={`p-2 rounded-full transition-colors ${menuOpen ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}>
            <EllipsisVertical className="w-5 h-5" />
          </button>
          {menuOpen && (
            <ChatHeaderMenu muted={isMutedIn(device, convId)} vanish={vanish} theme={(convId && device.themes[convId]) || 'default'}
              favorite={favorite} blocked={blocked} onClose={() => setMenuOpen(false)} onAction={(a) => { void onMenu(a); }} />
          )}
        </span>
      </header>
      )}

      {search !== null && onSearch && (
        <div className={`flex items-center gap-2 px-3 py-2 border-b ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`}>
          <Search className={`w-4 h-4 ${sub}`} />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search messages" aria-label="Search messages" autoFocus
            className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" />
          <button onClick={() => onSearch(null)} aria-label="Close search" className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>
      )}
      {pinnedId && (
        <div className={`flex items-center gap-2 px-3 py-2 border-b text-sm ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`} data-testid="pinned-banner">
          <Pin className="w-4 h-4 text-wa-green flex-shrink-0" />
          <button type="button" onClick={() => jumpTo(pinnedId)} className="flex-1 min-w-0 text-left truncate" aria-label="Go to pinned message">
            {byId.get(pinnedId) ? messagePreview(byId.get(pinnedId)!) : 'Pinned message'}
          </button>
          <button type="button" onClick={() => { const m = byId.get(pinnedId); if (m) void togglePin(m); else if (convId) void api.setPinnedMessage(convId, null).then(() => setPinnedId(null)); }}
            aria-label="Unpin message" className={`p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ${sub}`}><X className="w-4 h-4" /></button>
        </div>
      )}
      <div className="relative flex-1 min-h-0 flex flex-col">
      {/* the wallpaper (index.css .chat-wallpaper) is its own empty layer behind the scrolling messages */}
      {!secret && <div aria-hidden className={`absolute inset-0 pointer-events-none chat-wallpaper ${themeClass && `chat-wallpaper-tinted ${themeClass}`}`} />}
      {stickyDay && visible.length > 0 && (
        <div aria-hidden={!stickyShown} data-testid="sticky-day"
          className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-opacity duration-300 ${PILL} ${stickyShown ? 'opacity-100' : 'opacity-0'}`}>
          {stickyDay}
        </div>
      )}
      <div ref={listRef} onScroll={onListScroll}
        className="relative flex-1 overflow-y-auto px-3 py-3 space-y-1.5" aria-live="polite" data-testid="chat-messages">
        {!loading && !error && hasOlder && (
          <div className="flex justify-center pb-1">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className={`${PILL} flex items-center gap-1.5 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-70`}>
              {loadingOlder ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading older messages…</> : 'Click here to get older messages'}
            </button>
          </div>
        )}
        {loading ? (
          <ChatSkeleton />
        ) : error ? (
          <p role="alert" className="text-center text-sm text-wa-live py-8">{error}</p>
        ) : visible.length === 0 ? (
          <p className={`text-center text-xs py-10 ${sub}`}>{q ? 'No messages match.' : clearedAt && messages.length > 0 ? 'Chat cleared on this device.' : 'Say hi 👋 Messages here are private between the two of you.'}</p>
        ) : (
          visible.map((m, i) => {
            // WhatsApp's day pill above the first message of each day (also what the floating badge reads)
            const day = dayKey(m.created_at);
            const sep = i === 0 || dayKey(visible[i - 1].created_at) !== day
              ? <div key={`day-${day}`} className="flex justify-center py-1.5" data-day-label={chatDayLabel(m.created_at)}><span className={PILL}>{chatDayLabel(m.created_at)}</span></div>
              : null;
            if (m.kind === 'system') {
              return <Fragment key={m.id}>{sep}<p className={`text-center text-[11px] py-1.5 px-4 ${sub}`}><EmojiText text={m.body} /></p></Fragment>;
            }
            const mine = m.sender_id === me;
            const left = secondsLeft(m, now);
            const reply = m.reply_to_id ? byId.get(m.reply_to_id) : undefined;
            const bubble = (
              <MessageBubble m={m} mine={mine}
                statusLine={<>{left !== null ? `vanishes in ${left}s` : m.vanish ? (mine ? 'vanishes after read' : 'vanishes once read') : ''}{mine && !m.vanish && m.read_at ? 'Seen' : ''}</>}
                replyTo={reply} replyName={reply ? (reply.sender_id === me ? 'You' : label.title) : undefined}
                reactions={extras.summary[m.id]} myReaction={extras.myReaction(m.id)} starred={extras.starred.has(m.id)} pinned={pinnedId === m.id}
                highlighted={flash === m.id} onReact={(e) => { void extras.react(m.id, e); }} onAction={(a) => onAction(m, a)} onJump={jumpTo} />
            );
            if (!selected) return <Fragment key={m.id}>{sep}{bubble}</Fragment>;
            const on = selected.has(m.id);
            return (
              <Fragment key={m.id}>{sep}
                <div role="checkbox" aria-checked={on} aria-label={`Select message: ${messagePreview(m)}`} tabIndex={0}
                  onClick={() => toggleSelected(m.id)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelected(m.id); } }}
                  className={`relative -mx-3 px-3 py-0.5 cursor-pointer transition-colors duration-150 ${on ? 'bg-wa-green/15' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'}`}>
                  {/* only picked messages show a mark: a check on the side away from the bubble */}
                  {on && (
                    <span aria-hidden className={`absolute top-1/2 -translate-y-1/2 ${mine ? 'left-3' : 'right-3'} w-5 h-5 rounded-full bg-wa-green text-white flex items-center justify-center shadow animate-fade-in`}>
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </span>
                  )}
                  <div className="pointer-events-none">{bubble}</div>
                </div>
              </Fragment>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      </div>

      <form onSubmit={send} className={`px-2 pt-2 pb-3 border-t ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`} style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {ref && <div className="px-1 pb-2"><RefPreview type={ref.type} id={ref.id} onRemove={() => setRef(null)} /></div>}
        {blocked && (
          <div className={`flex items-center justify-center gap-2 px-3 py-2 mb-2 rounded-xl text-sm ${secret ? 'bg-zinc-800 text-zinc-300' : 'bg-wa-lightSecondary dark:bg-wa-darkSecondary'}`} data-testid="blocked-bar">
            <span>You blocked this contact.</span>
            <button type="button" className="font-medium text-wa-green" onClick={async () => {
              try { await api.setBlocked(me, otherUserId, false); setBlocked(false); show(`${label.title} unblocked`); } catch (err) { show(friendlyError(err), 'error'); }
            }}>Unblock</button>
          </div>
        )}
        {replyTo && <ReplyBar name={replyTo.sender_id === me ? 'yourself' : label.title} text={messagePreview(replyTo)} onCancel={() => setReplyTo(null)} />}
        <div className="flex items-center gap-1">
          {voice.active ? voice.bar : (
            <>
              <button
                type="button"
                disabled={!convId}
                aria-label="Attach a photo or video"
                title="Attach: tap for photo, hold for video"
                onClick={() => convId && openQuickSnap({
                  destination: { kind: 'chat', conversationId: convId, label: label.title },
                  onSent: () => { void syncMessages(); },
                })}
                className={`p-2 rounded-full disabled:opacity-40 ${secret ? 'text-zinc-300 hover:bg-white/10' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-black/5 dark:hover:bg-white/10'}`}
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <EmojiButton label="Add emoji to message" onPick={insertEmoji} />
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  const v = e.target.value.slice(0, MAX);
                  setText(v);
                  if (v.trim()) activity.typed(); else activity.stopped();
                }}
                placeholder={secret ? 'Secret message…' : 'Message'}
                aria-label="Write a message"
                disabled={!convId}
                className={`flex-1 min-w-0 rounded-full px-4 py-2.5 text-sm focus:outline-none border ${
                  secret ? 'bg-zinc-800 border-purple-500/30 text-zinc-100 placeholder:text-zinc-500 focus:border-purple-400'
                         : 'bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText border-wa-lightBorder dark:border-wa-darkBorder placeholder:text-wa-lightTextSecondary dark:placeholder:text-wa-darkTextSecondary focus:border-wa-green'
                }`}
              />
            </>
          )}
          {text.trim() && !voice.active ? (
            <button key="action" type="submit" disabled={sending || !convId} aria-label="Send message" className={`p-2.5 rounded-full text-white disabled:opacity-40 transition-colors ${secret ? 'bg-purple-600 hover:bg-purple-500' : 'bg-wa-green hover:bg-wa-greenDark'}`}>
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          ) : (
            <button key="action" {...voice.micProps} className={voice.micClass}>{voice.micIcon}</button>
          )}
        </div>
      </form>
      {deleting && (
        <DeleteMessageModal canDeleteForEveryone={deleting.sender_id === me} onClose={() => setDeleting(null)}
          onEveryone={async () => {
            await api.deleteMessage(deleting.id);
            setMessages((list) => list.filter((x) => x.id !== deleting.id));
            show('Message deleted for everyone');
          }}
          onMe={async () => { await extras.hideForMe(deleting.id); show('Message deleted for you'); }} />
      )}
      {infoFor && <MessageInfoModal message={infoFor} mine={infoFor.sender_id === me} onClose={() => setInfoFor(null)} />}
      {forwarding && convId && (
        <ForwardModal messages={forwarding} currentConversationId={convId} onClose={() => setForwarding(null)}
          onDone={(n) => { setSelected(null); show(`Forwarded to ${n} chat${n === 1 ? '' : 's'}`); }} />
      )}
      {reporting && <ReportModal targetType="message" targetId={reporting.id} onClose={() => setReporting(null)} />}
      {deletingSelected && selected && (
        <DeleteMessageModal canDeleteForEveryone={false} count={selected.size} onClose={() => setDeletingSelected(false)} onEveryone={async () => undefined}
          onMe={async () => {
            const n = selected.size;
            await Promise.all([...selected].map((id) => extras.hideForMe(id)));
            setSelected(null);
            show(n === 1 ? 'Message deleted for you' : `${n} messages deleted for you`);
          }} />
      )}
      {reportingUser && <ReportModal targetType="user" targetId={otherUserId} onClose={() => setReportingUser(false)} />}
      {confirm && (
        <ConfirmChatModal kind={confirm} name={label.title} blocked={blocked} onClose={() => setConfirm(null)} onConfirm={async () => {
          if (confirm === 'block') {
            await api.setBlocked(me, otherUserId, !blocked);
            show(blocked ? `${label.title} unblocked` : `${label.title} blocked`);
            setBlocked(!blocked);
          } else if (convId && confirm === 'clear') {
            clearChat(convId);
            show('Chat cleared');
          } else if (convId) {
            deleteChat(convId);
            show('Chat deleted');
            onClose();
          }
        }} />
      )}
    </Shell>
  );
}
