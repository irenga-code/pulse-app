import { useMemo, useState } from 'react';
import { Search, MessageSquareDot, Check, Plus } from 'lucide-react';
import VenueLogo from '@/components/VenueLogo';
import ChannelView from '@/components/channels/ChannelView';
import SectionHeader from '@/components/nav/SectionHeader';
import { ErrorNote, inputClass, mutedText, bodyText } from '@/components/ui';
import { useChannels } from '@/hooks/useChannels';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { timeAgo } from '@/lib/time';
import type { VenueChannel } from '@/lib/types';

/** Followed channels first, then every other venue channel to discover. Opening one shows its posts in place. */
export function ChannelsSection({ compact = false, onCreate }: { compact?: boolean; onCreate?: () => void }) {
  // compact = inside the phone's Updates page: an opened channel takes the whole screen so its composer stays put
  const { requireAuth } = useAuth();
  const ch = useChannels();
  const { venues } = useVenues({ orderBy: 'name' });
  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const open = ch.channels.find((c) => c.id === openId);
  if (open) {
    const view = (
      <ChannelView channel={open} venue={byId.get(open.venue_id)} following={ch.isFollowing(open.id)} canPost={ch.canPost(open.venue_id)}
        onToggleFollow={() => void ch.toggleFollow(open.id)} onBack={() => setOpenId(null)} />
    );
    return compact ? <div className="fixed inset-0 z-40 flex flex-col h-viewport bg-wa-light dark:bg-wa-dark">{view}</div> : view;
  }

  const q = query.trim().toLowerCase();
  const match = (c: VenueChannel) => !q || `${c.name} ${byId.get(c.venue_id)?.location ?? ''}`.toLowerCase().includes(q);
  const followed = ch.channels.filter((c) => ch.isFollowing(c.id) && match(c));
  const discover = ch.channels.filter((c) => !ch.isFollowing(c.id) && match(c));
  const label = `text-xs font-semibold uppercase tracking-wide px-4 pt-4 pb-1 ${mutedText}`;

  const row = (c: VenueChannel) => {
    const v = byId.get(c.venue_id);
    const following = ch.isFollowing(c.id);
    return (
      <li key={c.id} className="flex items-center hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60 transition-colors">
        <button onClick={() => setOpenId(c.id)} className="flex items-center gap-3 flex-1 min-w-0 pl-4 py-2.5 text-left" aria-label={`Open ${c.name}`}>
          {v ? <VenueLogo venue={v} size={48} fallback /> : <MessageSquareDot className="w-12 h-12 p-2.5 text-wa-green" />}
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-semibold truncate ${bodyText}`}>{c.name}</span>
            <span className={`block text-xs truncate ${mutedText}`}>
              {c.follower_count} follower{c.follower_count === 1 ? '' : 's'}{c.last_message_at ? ` · ${timeAgo(c.last_message_at)}` : ''}
            </span>
          </span>
        </button>
        <button
          onClick={() => { if (requireAuth('Sign in to follow channels.')) void ch.toggleFollow(c.id); }}
          aria-pressed={following}
          aria-label={following ? `Unfollow ${c.name}` : `Follow ${c.name}`}
          className={`mr-3 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold flex-shrink-0 ${following ? 'bg-wa-green/15 text-wa-green' : 'bg-wa-green text-white'}`}
        >
          {following ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}{following ? 'Following' : 'Follow'}
        </button>
      </li>
    );
  };

  return (
    <section aria-label="Channels">
      {compact && <h2 className={`text-lg font-bold px-4 pt-4 ${bodyText}`}>Channels</h2>}
      <div className="px-3 pt-2">
        <div className="relative">
          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels" aria-label="Search channels" className={`${inputClass} pl-9 !rounded-full !py-2`} />
        </div>
      </div>
      {ch.error && <div className="p-4"><ErrorNote message={ch.error} /></div>}
      {ch.loading ? (
        <p className={`text-sm px-4 py-6 ${mutedText}`}>Loading channels…</p>
      ) : ch.channels.length === 0 ? (
        <div className="text-center px-8 py-10">
          <MessageSquareDot className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
          <p className={`text-sm font-medium ${bodyText}`}>No channels yet</p>
          <p className={`text-xs mt-1 ${mutedText}`}>Follow channels to receive updates, news, and announcements here.</p>
          {onCreate && <button onClick={onCreate} className="mt-3 text-sm font-semibold text-wa-green">Browse Broadcasts</button>}
        </div>
      ) : (
        <>
          {followed.length > 0 && <><p className={label}>Following</p><ul>{followed.map(row)}</ul></>}
          {discover.length > 0 && <><p className={label}>{followed.length > 0 ? 'Find channels' : 'All channels'}</p><ul>{discover.map(row)}</ul></>}
          {followed.length + discover.length === 0 && <p className={`text-sm px-4 py-6 ${mutedText}`}>No channel matches.</p>}
        </>
      )}
    </section>
  );
}

export default function ChannelsTab({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <SectionHeader title="Channels" subtitle="Follow channels for updates, news, and announcements" />
      <ChannelsSection onCreate={onCreate} />
    </div>
  );
}
