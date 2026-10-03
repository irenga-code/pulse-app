import { Moon, Users, MapPin, Search, User, Activity } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export type TabId = 'tonight' | 'community' | 'venues' | 'search' | 'profile';

type Tab = {
  id: TabId;
  label: string;
  icon: typeof Moon;
};

const tabs: Tab[] = [
  { id: 'tonight', label: 'Tonight', icon: Moon },
  { id: 'community', label: 'Community', icon: Users },
  { id: 'venues', label: 'Venues', icon: MapPin },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'profile', label: 'Profile', icon: User },
];

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  variant: 'sidebar' | 'bottom';
};

export default function BottomNav({ activeTab, onTabChange, variant }: Props) {
  if (variant === 'sidebar') {
    return (
      <nav className="flex flex-col gap-1 flex-1 px-3 py-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-200 ${
                active
                  ? 'bg-wa-green/15 text-wa-green'
                  : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60'
              }`}
            >
              <Icon
                className="w-5 h-5 flex-shrink-0"
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="text-sm font-medium">{tab.label}</span>
              {active && <span className="ml-auto h-2 w-2 rounded-full bg-wa-green" />}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="sticky bottom-0 z-30 bg-wa-lightPanel dark:bg-wa-darkPanel border-t border-wa-lightBorder dark:border-wa-darkBorder transition-colors duration-300 md:hidden">
      <div className="flex items-center justify-around px-2 py-2 pb-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex flex-col items-center gap-1 px-3 py-1 transition-all duration-200 relative"
            >
              <Icon
                className={`w-5 h-5 transition-colors duration-200 ${
                  active
                    ? 'text-wa-green'
                    : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
                }`}
                strokeWidth={active ? 2.5 : 2}
              />
              <span
                className={`text-[10px] font-medium transition-colors duration-200 ${
                  active
                    ? 'text-wa-green'
                    : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
                }`}
              >
                {tab.label}
              </span>
              {active && (
                <span className="absolute -mt-1 h-1 w-6 rounded-full bg-wa-green" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function SidebarBranding() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="px-5 py-5 border-b border-wa-lightBorder dark:border-wa-darkBorder">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-wa-green flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-xl font-bold text-wa-lightText dark:text-wa-darkText">Pulse</span>
        </div>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Moon className="w-5 h-5 text-wa-darkTextSecondary" />
          ) : (
            <Moon className="w-5 h-5 text-wa-lightTextSecondary" />
          )}
        </button>
      </div>
    </div>
  );
}
