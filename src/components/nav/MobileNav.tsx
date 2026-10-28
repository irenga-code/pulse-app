import { MOBILE_TABS, mobileTabFor, type SectionId } from '@/components/nav/sections';

/** Phone bottom bar: Chats, Updates, Communities, Tools, You. */
export default function MobileNav({ active, onSelect, badges = {} }: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  badges?: Partial<Record<SectionId, number>>;
}) {
  const current = mobileTabFor(active);
  return (
    <nav aria-label="Main" className="md:hidden sticky bottom-0 z-30 bg-wa-lightPanel dark:bg-wa-darkPanel border-t border-wa-lightBorder dark:border-wa-darkBorder"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-stretch justify-around px-1 pt-1.5 pb-2">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const on = current === tab.id;
          const badge = badges[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={on ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-0.5 py-0.5"
            >
              <span className={`relative px-4 py-1 rounded-full transition-colors duration-200 ${on ? 'bg-wa-green/15' : ''}`}>
                <Icon className={`w-[22px] h-[22px] ${on ? 'text-wa-green' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'}`} strokeWidth={on ? 2.4 : 1.9} />
                {!!badge && (
                  <span className="absolute -top-1 right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-wa-green text-white text-[10px] font-bold flex items-center justify-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className={`text-[11px] font-medium ${on ? 'text-wa-green' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'}`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
