import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Send, Loader2, Trash2, Check, Plus, MessageSquareDot } from 'lucide-react';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import type { ChannelMessage, Channel } from '@/lib/types';

let channelCounter = 0;
const MAX = 2000;

/** One channel: everyone reads, followers get it in their list, its team posts (text or Quick-Snap). */
export default function ChannelView({ channel, following, canPost, onToggleFollow, onBack }: {
  channel: Channel;
  following: boolean;
  canPost: boolean;
  onToggleFollow: () => void;
  onBack: () => void;
}) {
  const { show } = useToast();
  const { requireAuth } = useAuth();
  const { openQuickSnap } = useQuickSnap();
  const [posts, setPosts] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setPosts(await api.listChannelMessages(channel.id));
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const add = (m: ChannelMessage) => setPosts((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    const ch = supabase
      .channel(`channel-${channel.id}-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: `channel_id=eq.${channel.id}` }, (p) => add(p.new as ChannelMessage))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channel_messages' }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) setPosts((list) => list.filter((m) => m.id !== id));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [posts.length, loading]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await api.postChannelMessage(channel.id, { body });
      setPosts((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      setText('');
    } catch (err) {
      show(friendlyError(err), 'error');
    }
    setSending(false);
  };

  const remove = async (m: ChannelMessage) => {
    try {
      await api.deleteChannelMessage(m.id);
      setPosts((list) => list.filter((x) => x.id !== m.id));
      show('Post deleted');
    } catch (err) {
      show(friendlyError(err), 'error');
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 animate-section-in">
      <header className="flex items-center gap-2 px-2 py-2.5 border-b border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
        <button onClick={onBack} aria-label="Back to channels" className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${bodyText}`}><ArrowLeft className="w-5 h-5" /></button>
        <MessageSquareDot className="w-8 h-8 text-wa-green" />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold truncate ${bodyText}`}>{channel.name}</span>
          <span className={`block text-[11px] truncate ${mutedText}`}>{channel.follower_count} follower{channel.follower_count === 1 ? '' : 's'}</span>
        </span>
        <button
          onClick={() => { if (requireAuth('Sign in to follow channels.')) onToggleFollow(); }}
          aria-pressed={following}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${following ? 'bg-wa-green/15 text-wa-green' : 'bg-wa-green text-white'}`}
        >
          {following ? <><Check className="w-3.5 h-3.5" />Following</> : <><Plus className="w-3.5 h-3.5" />Follow</>}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 space-y-2 bg-wa-light dark:bg-wa-dark" aria-live="polite">
        {channel.description && <p className={`text-center text-xs px-6 pb-2 ${mutedText}`}>{channel.description}</p>}
        {loading ? (
          <p className={`text-center text-sm py-10 ${mutedText}`}>Loading…</p>
        ) : error ? (
          <ErrorNote message={error} />
        ) : posts.length === 0 ? (
          <p className={`text-center text-sm py-10 ${mutedText}`}>No posts yet.{canPost ? ' Your first post goes to every follower.' : ''}</p>
        ) : (
          posts.map((m) => (
            <article key={m.id} className="group max-w-[85%] md:max-w-md rounded-2xl rounded-tl-md bg-wa-lightPanel dark:bg-wa-darkSecondary px-3 py-2 shadow-sm">
              {m.media_url && (
                m.media_type === 'video'
                  ? <video src={m.media_url} controls playsInline preload="metadata" aria-label="Channel video" className="-mx-1 mb-1.5 w-64 max-w-full rounded-xl bg-black" />
                  : <img src={m.media_url} alt="Channel photo" loading="lazy" className="-mx-1 mb-1.5 w-64 max-w-full rounded-xl bg-black object-cover" />
              )}
              {m.body && <p className={`text-sm whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={m.body} /></p>}
              <p className={`mt-1 text-[10px] flex items-center justify-end gap-2 ${mutedText}`}>
                {canPost && (
                  <button onClick={() => remove(m)} aria-label="Delete post" className="md:opacity-0 md:group-hover:opacity-100 hover:text-wa-live transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
                {timeAgo(m.created_at)}
              </p>
            </article>
          ))
        )}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <form onSubmit={send} className="flex items-center gap-1 px-2 pt-2 pb-3 border-t border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
          <button type="button" aria-label="Snap to channel"
            onClick={() => openQuickSnap({ destination: { kind: 'channel', channelId: channel.id, label: channel.name }, onSent: () => { void load(); } })}
            className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${mutedText}`}>
            <Camera className="w-5 h-5" />
          </button>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} placeholder={`Post to ${channel.name}`} aria-label="Write a channel post"
            className="flex-1 min-w-0 rounded-full px-4 py-2.5 text-sm focus:outline-none border bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText border-wa-lightBorder dark:border-wa-darkBorder focus:border-wa-green" />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Post to channel" className="p-2.5 rounded-full text-white bg-wa-green hover:bg-wa-greenDark disabled:opacity-40">
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      ) : (
        <p className={`text-center text-xs py-3 border-t border-wa-lightBorder dark:border-wa-darkBorder ${mutedText}`}>Only the channel's team can post here.</p>
      )}
    </div>
  );
}
