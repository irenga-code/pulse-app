import { useEffect, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { useStatuses } from '@/hooks/useStatuses';
import { useChannels } from '@/hooks/useChannels';
import { useLiveVenueCount } from '@/hooks/useVenues';
import { RAIL_BOTTOM, RAIL_BUSINESS, RAIL_TOP, type SectionDef, type SectionId } from '@/components/nav/sections';

type Props = {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onSettings: () => void;
  /** Unread counts by section (Chats, ...). */
  badges?: Partial<Record<SectionId, number>>;
};

const CHANNELS_SEEN_KEY = 'pulse:channels-seen-at';
const readSeen = () => { try { return Number(localStorage.getItem(CHANNELS_SEEN_KEY)) || 0; } catch { return 0; } };

/**
 * Green dots, WhatsApp-style: Status = someone posted a status you have not seen, Channels = a channel you follow
 * posted since you last opened Channels, Catalog = a venue is live right now.
 */
function useRailDots(active: SectionId): Partial<Record<SectionId, boolean>> {
  const { groups } = useStatuses();
  const ch = useChannels();
  const live = useLiveVenueCount();
  const [seenAt, setSeenAt] = useState(readSeen);
  useEffect(() => {
    if (active !== 'channels') return;
    const now = Date.now();
    setSeenAt(now);
    try { localStorage.setItem(CHANNELS_SEEN_KEY, String(now)); } catch { /* per-device convenience only */ }
  }, [active]);
  return useMemo(() => ({
    status: groups.some((g) => g.unseen),
    channels: ch.channels.some((c) => ch.isFollowing(c.id) && !!c.last_message_at && new Date(c.last_message_at).getTime() > seenAt),
    catalog: live > 0,
  }), [groups, ch, live, seenAt]);
}

const itemBase = 'relative p-3 rounded-2xl cursor-pointer flex items-center justify-center transition-[background-color,color,transform] duration-200 active:scale-95';
const idle = 'text-zinc-600 dark:text-wa-darkTextSecondary hover:bg-slate-200/80 dark:hover:bg-white/10';
const current = 'bg-zinc-800 text-white dark:bg-white/15';
const dotClass = 'absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-wa-green border-2 border-[#f0f2f5] dark:border-wa-darkPanel';

function RailButton({ def, active, badge, dot, onClick }: { def: SectionDef; active: boolean; badge?: number; dot?: boolean; onClick: () => void }) {
  const Icon = def.icon;
  const note = badge ? `, ${badge} unread` : dot ? ', new' : '';
  return (
    <button type="button" onClick={onClick} aria-label={`${def.label}${note}`} aria-current={active ? 'page' : undefined} title={def.label}
      className={`${itemBase} ${active ? current : idle}`}>
      <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.2 : 1.8} />
      {!!badge && (
        <span className="absolute -top-1 -right-1 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-wa-green text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#f0f2f5] dark:border-wa-darkPanel">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!badge && dot && <span className={dotClass} aria-hidden="true" />}
    </button>
  );
}

/** WhatsApp desktop rail: messaging, divider, business tools; media, settings and your photo at the bottom. */
export default function LeftRail({ active, onSelect, onSettings, badges = {} }: Props) {
  const { user, profile, openAuth } = useAuth();
  const dots = useRailDots(active);
  const render = (defs: SectionDef[]) =>
    defs.map((d) => <RailButton key={d.id} def={d} active={active === d.id} badge={badges[d.id]} dot={dots[d.id]} onClick={() => onSelect(d.id)} />);

  return (
    <nav aria-label="Main" className="hidden md:flex w-16 h-full flex-shrink-0 flex-col items-center justify-between py-4 bg-[#f0f2f5] dark:bg-wa-darkPanel border-r border-gray-200 dark:border-wa-darkBorder">
      <div className="flex flex-col items-center gap-1">
        {render(RAIL_TOP)}
        <div className="border-b border-gray-300 dark:border-wa-darkBorder w-8 my-2" role="separator" />
        {render(RAIL_BUSINESS)}
      </div>
      <div className="flex flex-col items-center gap-1">
        {render(RAIL_BOTTOM)}
        <button type="button" onClick={onSettings} aria-label="Settings" title="Settings" className={`${itemBase} ${idle}`}>
          <Settings className="w-[22px] h-[22px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => (user ? onSelect('profile') : openAuth('signin'))}
          aria-label={user ? 'Your profile' : 'Sign in'}
          aria-current={active === 'profile' ? 'page' : undefined}
          title={user ? 'Profile' : 'Sign in'}
          className={`mt-1 rounded-full p-0.5 transition-shadow ${active === 'profile' ? 'ring-2 ring-zinc-800 dark:ring-white/70' : 'hover:ring-2 hover:ring-slate-300'}`}
        >
          <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={34} />
        </button>
      </div>
    </nav>
  );
}
