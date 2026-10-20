import { useCallback, useEffect } from 'react';
import { X, Ghost, MessageCircle } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { timeAgo } from '@/lib/time';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import type { ConversationSummary, PublicProfile } from '@/lib/types';
import { ListSkeleton } from '@/components/Skeleton';
import { memUserKey } from '@/lib/cache';

let channelCounter = 0;

export default function InboxView({ onOpen, onClose }: { onOpen: (otherUserId: string) => void; onClose: () => void }) {
  const { user } = useAuth();
  const data = useAsync(async () => {
    const rows = await api.listConversations();
    const people = await api.profilesByIds(rows.map((r) => r.other_user_id));
    return { rows, people };
  }, [], user ? memUserKey(user.id, 'inbox') : null); // message previews stay in memory only (vanish mode)
  const { reload } = data;

  // new messages / read receipts update the list live
  const refresh = useCallback(() => { void reload(); }, [reload]);
  useEffect(() => {
    let t: number | undefined;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(refresh, 400); };
    const channel = supabase.channel(`inbox-${++channelCounter}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, soon).subscribe();
    const tick = window.setInterval(refresh, 30_000); // also drops vanished last-messages
    return () => { window.clearTimeout(t); window.clearInterval(tick); supabase.removeChannel(channel); };
  }, [refresh]);

  const preview = (c: ConversationSummary) => {
    if (!c.last_body) return 'No messages yet';
    const who = c.last_sender_id === user?.id ? 'You: ' : '';
    return c.last_kind === 'system' ? c.last_body : who + c.last_body;
  };

  return (
    <>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
        <MessageCircle className="w-5 h-5 text-wa-green" />
        <h2 className={`flex-1 text-base font-bold ${bodyText}`}>Messages</h2>
        <button onClick={onClose} aria-label="Close messages" className={`p-1.5 rounded-full ${mutedText} hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary`}><X className="w-5 h-5" /></button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {data.loading && !data.data ? (
          <div className="px-4"><ListSkeleton label="Loading conversations" /></div>
        ) : data.error ? (
          <div className="p-4"><ErrorNote message={data.error} /></div>
        ) : data.data!.rows.length === 0 ? (
          <div className="text-center px-8 py-16">
            <MessageCircle className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
            <p className={`text-sm font-medium ${bodyText}`}>No conversations yet</p>
            <p className={`text-xs mt-1 ${mutedText}`}>Tap someone's name on a post or status, then press Message.</p>
          </div>
        ) : (
          <ul className="divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
            {data.data!.rows.map((c) => {
              const p: PublicProfile | undefined = data.data!.people[c.other_user_id];
              return (
                <li key={c.conversation_id}>
                  <button onClick={() => onOpen(c.other_user_id)} className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60 transition-colors">
                    <Avatar name={p?.display_name ?? '?'} url={p?.avatar_url} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold truncate ${bodyText}`}>{p?.display_name ?? 'Pulse user'}</span>
                        {c.vanish_mode && <Ghost className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" aria-label="Secret mode on" />}
                        <span className={`ml-auto text-[11px] flex-shrink-0 ${mutedText}`}>{timeAgo(c.last_message_at)}</span>
                      </span>
                      <span className={`flex items-center gap-2 text-xs mt-0.5 ${c.unread_count > 0 ? `font-semibold ${bodyText}` : mutedText}`}>
                        <span className="truncate flex-1">
                          {c.last_vanish && c.last_kind === 'text' && '👻 '}<EmojiText text={preview(c)} />
                        </span>
                        {c.unread_count > 0 && (
                          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-wa-green text-white text-[11px] font-bold flex items-center justify-center">{c.unread_count}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
