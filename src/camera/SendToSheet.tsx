import { useMemo, useState } from 'react';
import { X, Check, Send, Loader2, Users, CircleDashed, MessageSquareDot, MessageCircle } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { api } from '@/lib/apiClient';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { memUserKey } from '@/lib/cache';
import { destinationKey, type SnapDestination } from '@/camera/useSnapDispatch';

/**
 * Snapchat-style "Send To": your Pulse feed, your 24 h status, the channels you run, and your chats.
 * Pick any mix; the snap is uploaded once and sent to all of them.
 */
export default function SendToSheet({ initial, busy, onSend, onClose }: {
  initial: SnapDestination[];
  busy: boolean;
  onSend: (destinations: SnapDestination[]) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [picked, setPicked] = useState<Map<string, SnapDestination>>(() => new Map(initial.map((d) => [destinationKey(d), d])));
  const [query, setQuery] = useState('');

  const data = useAsync(async () => {
    if (!user) return { channels: [], chats: [], people: {} };
    const [managed, channels, chats] = await Promise.all([api.managedVenueIds(user.id), api.listChannels(), api.listConversations()]);
    const people = await api.profilesByIds(chats.map((c) => c.other_user_id));
    return { channels: channels.filter((c) => managed.includes(c.venue_id)), chats, people };
  }, [], user ? memUserKey(user.id, 'snap-send-to') : null);

  const toggle = (d: SnapDestination) => setPicked((m) => {
    const next = new Map(m);
    const k = destinationKey(d);
    if (next.has(k)) next.delete(k);
    else next.set(k, d);
    return next;
  });

  const q = query.trim().toLowerCase();
  const chats = useMemo(() => {
    const rows = data.data?.chats ?? [];
    return rows
      .map((c) => ({ c, name: data.data?.people[c.other_user_id]?.display_name ?? 'Pulse user' }))
      .filter(({ name }) => !q || name.toLowerCase().includes(q));
  }, [data.data, q]);

  const row = (d: SnapDestination, icon: React.ReactNode, title: string, sub?: string) => {
    const on = picked.has(destinationKey(d));
    return (
      <button key={destinationKey(d)} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(d)}
        className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${on ? 'bg-wa-green/25' : 'hover:bg-white/10'}`}>
        {icon}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold truncate">{title}</span>
          {sub && <span className="block text-[11px] text-white/60 truncate">{sub}</span>}
        </span>
        <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? 'bg-wa-green border-wa-green' : 'border-white/50'}`}>
          {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
        </span>
      </button>
    );
  };
  const iconBox = (node: React.ReactNode) => <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">{node}</span>;
  const heading = 'text-[11px] uppercase tracking-wide text-wa-green mt-3 mb-1 px-1';
  const list = [...picked.values()];

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 max-h-[85%] flex flex-col rounded-t-3xl bg-black/90 backdrop-blur-md text-white animate-slide-up" role="dialog" aria-label="Send to">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <p className="text-base font-bold flex-1">Send to…</p>
        <button onClick={onClose} aria-label="Close send to" className="p-1"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
        <p className={heading}>Share</p>
        {row({ kind: 'status' }, iconBox(<CircleDashed className="w-5 h-5 text-wa-green" />), 'My status',
          '24 hours · with time')}
        {row({ kind: 'feed' }, iconBox(<Users className="w-5 h-5 text-wa-green" />), 'Pulse feed', 'A snap post in Communities')}

        {(data.data?.channels.length ?? 0) > 0 && (
          <>
            <p className={heading}>Your channels</p>
            {data.data!.channels.map((ch) =>
              row({ kind: 'channel', channelId: ch.id, label: ch.name }, iconBox(<MessageSquareDot className="w-5 h-5 text-wa-green" />), ch.name,
                `${ch.follower_count} follower${ch.follower_count === 1 ? '' : 's'}`))}
          </>
        )}

        <p className={heading}>Chats</p>
        {(data.data?.chats.length ?? 0) > 4 && (
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats"
            className="w-full mb-1 rounded-xl bg-white/10 px-3 py-2 text-sm placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-wa-green" />
        )}
        {data.loading && !data.data ? (
          <p className="text-xs text-white/60 px-1 py-2">Loading chats…</p>
        ) : chats.length === 0 ? (
          <p className="text-xs text-white/60 px-1 py-2 flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />{q ? 'No chat matches.' : 'No chats yet.'}</p>
        ) : (
          chats.map(({ c, name }) =>
            row({ kind: 'chat', conversationId: c.conversation_id, label: name },
              <Avatar name={name} url={data.data?.people[c.other_user_id]?.avatar_url} size={40} />, name, 'Private snap'))
        )}
      </div>
      <div className="px-4 pt-2 pb-4 border-t border-white/10 flex items-center gap-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="flex-1 min-w-0 text-xs text-white/70 truncate">
          {list.length === 0 ? 'Pick where to send it' : list.map((d) => (d.kind === 'feed' ? 'Feed' : d.kind === 'status' ? 'Status' : d.label)).join(', ')}
        </p>
        <button onClick={() => onSend(list)} disabled={busy || list.length === 0} data-testid="send-snap"
          className="flex items-center gap-2 rounded-full bg-wa-green px-5 py-2.5 text-sm font-bold disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send{list.length > 1 ? ` (${list.length})` : ''}
        </button>
      </div>
    </div>
  );
}
