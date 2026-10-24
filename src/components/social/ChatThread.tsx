import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X, Send, Ghost, Loader2, Camera } from 'lucide-react';
import Avatar from '@/components/Avatar';
import ChatShell from '@/components/social/ChatShell';
import RefPreview from '@/components/social/RefPreview';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { useEmojiInsert } from '@/components/emoji/useEmojiInsert';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import type { ChatMessage, MessageRef, PublicProfile } from '@/lib/types';
import { ChatSkeleton } from '@/components/Skeleton';

let channelCounter = 0;
const MAX = 2000;

const isLive = (m: ChatMessage, now: number) => !m.expires_at || new Date(m.expires_at).getTime() > now;
const byTime = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
/** Countdown starts when the other person has read the message (unread ones only carry the 24 h fallback). */
const secondsLeft = (m: ChatMessage, now: number) => (m.expires_at && m.read_at ? Math.max(0, Math.ceil((new Date(m.expires_at).getTime() - now) / 1000)) : null);

/** One private conversation with live updates and Secret (vanish) mode. */
export default function ChatThread({ otherUserId, initialRef, onBack, onClose }: {
  otherUserId: string; initialRef: MessageRef | null; onBack: () => void; onClose: () => void;
}) {
  const { user } = useAuth();
  const { show } = useToast();
  const { refreshUnread, openProfile } = useSocial();
  const { openQuickSnap } = useQuickSnap();
  const me = user?.id ?? '';
  const [convId, setConvId] = useState<string | null>(null);
  const [other, setOther] = useState<PublicProfile | null>(null);
  const [vanish, setVanish] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [ref, setRef] = useState<MessageRef | null>(initialRef);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const readTimer = useRef<number | undefined>(undefined);
  const convRef = useRef<string | null>(null);
  const insertEmoji = useEmojiInsert(inputRef, text, setText, MAX);

  // 1. find or create the conversation, and who we are talking to
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [id, people] = await Promise.all([api.startConversation(otherUserId), api.profilesByIds([otherUserId])]);
        if (!alive) return;
        setOther(people[otherUserId] ?? null);
        convRef.current = id;
        setConvId(id);
      } catch (e) {
        if (!alive) return;
        setError(friendlyError(e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [otherUserId]);

  /** Re-read the history (picks up read receipts and vanish times even if a Realtime event was missed). */
  const syncMessages = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    try {
      const rows = await api.listMessages(id);
      setMessages((list) => {
        const fresh = new Map(rows.map((m) => [m.id, m]));
        const seen = new Set<string>();
        // keep messages we just sent that the server has not returned yet; everything else comes from the server
        const merged = [...list.filter((m) => !fresh.has(m.id) && Date.now() - new Date(m.created_at).getTime() < 15_000), ...rows];
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort(byTime);
      });
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

    Promise.all([api.listMessages(convId), api.getConversation(convId)])
      .then(([rows, conv]) => {
        if (!alive) return;
        setMessages(rows);
        setVanish(!!conv?.vanish_mode);
        setLoading(false);
        markRead();
      })
      .catch((e) => { if (alive) { setError(friendlyError(e)); setLoading(false); } });

    const channel = supabase
      .channel(`chat-${convId}-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => {
        const m = payload.new as ChatMessage;
        upsert(m);
        if (m.sender_id !== me) markReadSoon();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload) => upsert(payload.new as ChatMessage))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${convId}` }, (payload) => {
        setVanish(!!(payload.new as { vanish_mode?: boolean }).vanish_mode);
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
  }, [convId, me, markRead, markReadSoon, syncMessages]);

  // 3. vanish countdown: only runs while something is counting down
  const counting = useMemo(() => messages.some((m) => m.expires_at && m.read_at), [messages]);
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now()); // the clock was idle until now: sync it before the first tick so the number shown is right
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  const visible = useMemo(() => messages.filter((m) => isLive(m, now)), [messages, now]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [visible.length, loading]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !convId || sending) return;
    setSending(true);
    try {
      const m = await api.sendMessage(convId, body, ref);
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort(byTime)));
      setText('');
      setRef(null);
    } catch (err) {
      show(friendlyError(err), 'error');
    }
    setSending(false);
    inputRef.current?.focus();
  };

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

  const secret = vanish;
  const sub = secret ? 'text-zinc-400' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary';

  return (
    <ChatShell label={`Chat with ${other?.display_name ?? 'user'}`} onClose={onClose} secret={secret}>
      <header className={`flex items-center gap-2 px-2 py-2.5 border-b ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`}>
        <button onClick={onBack} aria-label="Back to messages" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
        <button onClick={() => openProfile(otherUserId)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
          <Avatar name={other?.display_name ?? '?'} url={other?.avatar_url} size={36} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">{other?.display_name ?? 'Pulse user'}</span>
            <span className={`block text-[11px] ${sub}`}>{secret ? 'Secret mode: messages vanish after being read' : 'Private chat'}</span>
          </span>
        </button>
        <button
          onClick={toggleVanish}
          disabled={!convId}
          aria-pressed={secret}
          aria-label={secret ? 'Turn off secret mode' : 'Turn on secret mode'}
          title="Secret mode"
          className={`p-2 rounded-full transition-colors ${secret ? 'bg-purple-600 text-white' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}
        >
          <Ghost className="w-5 h-5" />
        </button>
        <button onClick={onClose} aria-label="Close chat" className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5" aria-live="polite" data-testid="chat-messages">
        {loading ? (
          <ChatSkeleton />
        ) : error ? (
          <p role="alert" className="text-center text-sm text-wa-live py-8">{error}</p>
        ) : visible.length === 0 ? (
          <p className={`text-center text-xs py-10 ${sub}`}>Say hi 👋 Messages here are private between the two of you.</p>
        ) : (
          visible.map((m) => {
            if (m.kind === 'system') {
              return <p key={m.id} className={`text-center text-[11px] py-1.5 px-4 ${sub}`}><EmojiText text={m.body} /></p>;
            }
            const mine = m.sender_id === me;
            const left = secondsLeft(m, now);
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  data-testid="chat-bubble"
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug shadow-sm ${
                    mine
                      ? m.vanish ? 'bg-purple-600 text-white rounded-br-md' : 'bg-wa-green text-white rounded-br-md'
                      : m.vanish ? 'bg-zinc-800 text-zinc-100 rounded-bl-md' : 'bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightText dark:text-wa-darkText rounded-bl-md'
                  }`}
                >
                  {m.ref_type && m.ref_id && <div className="mb-1.5"><RefPreview type={m.ref_type} id={m.ref_id} tone="bubble" /></div>}
                  {m.media_url && (
                    m.media_type === 'video'
                      ? <video src={m.media_url} controls playsInline preload="metadata" aria-label="Video snap" className="-mx-1 mb-1 w-56 max-w-full aspect-[9/16] rounded-xl bg-black object-cover" />
                      : <img src={m.media_url} alt="Photo snap" loading="lazy" className="-mx-1 mb-1 w-56 max-w-full aspect-[9/16] rounded-xl bg-black object-cover" />
                  )}
                  {/* a snap without a caption carries a placeholder body ("📸 Snap"); the picture says it already */}
                  {!(m.media_url && /^(📸|🎥) Snap$/u.test(m.body)) && <p className="whitespace-pre-wrap break-words"><EmojiText text={m.body} /></p>}
                  <p className="mt-0.5 text-[10px] opacity-75 text-right flex items-center justify-end gap-1">
                    {m.vanish && <Ghost className="w-3 h-3" />}
                    {left !== null ? `vanishes in ${left}s` : m.vanish ? (mine ? 'vanishes after read' : 'vanishes once read') : ''}
                    {mine && !m.vanish && m.read_at ? 'Seen' : ''}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className={`px-2 pt-2 pb-3 border-t ${secret ? 'border-purple-500/30 bg-zinc-900' : 'border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel'}`} style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {ref && <div className="px-1 pb-2"><RefPreview type={ref.type} id={ref.id} onRemove={() => setRef(null)} /></div>}
        <div className="flex items-center gap-1">
          <EmojiButton label="Add emoji to message" onPick={insertEmoji} />
          <button
            type="button"
            disabled={!convId}
            aria-label="Send a snap"
            title="Quick-Snap: tap for photo, hold for video"
            onClick={() => convId && openQuickSnap({
              destination: { kind: 'chat', conversationId: convId, label: other?.display_name ?? 'this chat' },
              onSent: () => { void syncMessages(); },
            })}
            className={`p-2 rounded-full disabled:opacity-40 ${secret ? 'text-zinc-300 hover:bg-white/10' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-black/5 dark:hover:bg-white/10'}`}
          >
            <Camera className="w-5 h-5" />
          </button>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            placeholder={secret ? 'Secret message…' : 'Message'}
            aria-label="Write a message"
            disabled={!convId}
            className={`flex-1 min-w-0 rounded-full px-4 py-2.5 text-sm focus:outline-none border ${
              secret ? 'bg-zinc-800 border-purple-500/30 text-zinc-100 placeholder:text-zinc-500 focus:border-purple-400'
                     : 'bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText border-wa-lightBorder dark:border-wa-darkBorder placeholder:text-wa-lightTextSecondary dark:placeholder:text-wa-darkTextSecondary focus:border-wa-green'
            }`}
          />
          <button type="submit" disabled={sending || !text.trim() || !convId} aria-label="Send message" className={`p-2.5 rounded-full text-white disabled:opacity-40 transition-colors ${secret ? 'bg-purple-600 hover:bg-purple-500' : 'bg-wa-green hover:bg-wa-greenDark'}`}>
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </form>
    </ChatShell>
  );
}
