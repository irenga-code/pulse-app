import { Activity, Settings } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { RAIL_BOTTOM, RAIL_BUSINESS, RAIL_TOP, type SectionDef, type SectionId } from '@/components/nav/sections';

type Props = {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onSettings: () => void;
  /** Unread counts by section (Chats, Channels, ...). */
  badges?: Partial<Record<SectionId, number>>;
  /** Small dot without a number (e.g. a channel has new posts). */
  dots?: Partial<Record<SectionId, boolean>>;
};

const itemBase = 'relative w-11 h-11 rounded-2xl flex items-center justify-center transition-[background-color,color,transform] duration-200 active:scale-95';

function RailButton({ def, active, badge, dot, onClick }: { def: SectionDef; active: boolean; badge?: number; dot?: boolean; onClick: () => void }) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={def.label}
      aria-current={active ? 'page' : undefined}
      title={def.label}
      className={`${itemBase} ${
        active ? 'bg-wa-green/15 text-wa-green' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/70'
      }`}
    >
      <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.4 : 1.9} />
      {!!badge && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-wa-green text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {!badge && dot && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-wa-green" aria-hidden="true" />}
    </button>
  );
}

/** WhatsApp Business desktop rail: messaging, divider, business tools, then media / settings / you at the bottom. */
export default function LeftRail({ active, onSelect, onSettings, badges = {}, dots = {} }: Props) {
  const { user, profile, openAuth } = useAuth();
  const render = (defs: SectionDef[]) =>
    defs.map((d) => <RailButton key={d.id} def={d} active={active === d.id} badge={badges[d.id]} dot={dots[d.id]} onClick={() => onSelect(d.id)} />);

  return (
    <nav aria-label="Main" className="hidden md:flex w-[72px] flex-shrink-0 flex-col items-center gap-1.5 py-3 bg-wa-lightPanel dark:bg-wa-darkPanel border-r border-wa-lightBorder dark:border-wa-darkBorder">
      <div className="w-10 h-10 mb-2 rounded-xl bg-wa-green flex items-center justify-center" aria-hidden="true">
        <Activity className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
      {render(RAIL_TOP)}
      <hr className="w-8 my-1.5 border-wa-lightBorder dark:border-wa-darkBorder" />
      {render(RAIL_BUSINESS)}
      <div className="flex-1" />
      {render(RAIL_BOTTOM)}
      <button type="button" onClick={onSettings} aria-label="Settings" title="Settings"
        className={`${itemBase} text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/70`}>
        <Settings className="w-[22px] h-[22px]" strokeWidth={1.9} />
      </button>
      <button
        type="button"
        onClick={() => (user ? onSelect('profile') : openAuth('signin'))}
        aria-label={user ? 'Your profile' : 'Sign in'}
        aria-current={active === 'profile' ? 'page' : undefined}
        title={user ? 'Profile' : 'Sign in'}
        className={`mt-1 rounded-full p-0.5 transition-shadow ${active === 'profile' ? 'ring-2 ring-wa-green' : ''}`}
      >
        <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={34} />
      </button>
    </nav>
  );
}
