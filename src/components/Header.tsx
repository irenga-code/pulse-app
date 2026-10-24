import { useState } from 'react';
import { Sun, Moon, ChevronDown, Activity, Camera } from 'lucide-react';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { useTheme } from '@/context/ThemeContext';
import { useSettings } from '@/context/SettingsContext';
import { useLiveVenueCount } from '@/hooks/useVenues';

export default function Header() {
  const { theme } = useTheme();
  const { setThemePreference } = useSettings();
  const [cityOpen, setCityOpen] = useState(false);
  const liveCount = useLiveVenueCount();
  const { openQuickSnap } = useQuickSnap();

  return (
    <header className="md:hidden sticky top-0 z-30 bg-wa-lightHeader dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder transition-colors duration-300">
      <div className="flex items-center justify-between px-4 py-3">
        {/* App name + city selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Activity className="w-5 h-5 text-wa-greenLight" strokeWidth={2.5} />
            <span className="text-white text-lg font-bold tracking-tight">Pulse</span>
          </div>
          <div className="h-5 w-px bg-white/25" />
          <div className="relative">
            <button
              onClick={() => setCityOpen((v) => !v)}
              className="flex items-center gap-1 text-white/90 text-sm font-medium tracking-tight"
            >
              Kampala
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${cityOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {cityOpen && (
              <div className="absolute top-full left-0 mt-2 w-44 bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-lg shadow-xl border border-wa-lightBorder dark:border-wa-darkBorder py-1 animate-fade-in">
                <div className="px-4 py-2 text-sm font-medium text-wa-lightText dark:text-wa-darkText bg-wa-green/10 cursor-default rounded-md">
                  Kampala
                </div>
                <div className="px-4 py-2 text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary cursor-default">
                  Entebbe
                </div>
                <div className="px-4 py-2 text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary cursor-default">
                  Jinja
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          {liveCount > 0 && (
            <div className="flex items-center gap-1.5 bg-white/15 dark:bg-wa-darkSecondary/60 rounded-full px-2.5 py-1" aria-label={`${liveCount} venues live now`}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-wa-live animate-pulse-dot" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-wa-live" />
              </span>
              <span className="text-xs font-medium text-white dark:text-wa-darkText">LIVE · {liveCount}</span>
            </div>
          )}

          <button onClick={() => openQuickSnap()} aria-label="Quick-Snap camera" className="p-2 rounded-full hover:bg-white/10 dark:hover:bg-wa-darkSecondary/60 transition-colors duration-200">
            <Camera className="w-5 h-5 text-white dark:text-wa-darkText" />
          </button>
          <button
            onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-full hover:bg-white/10 dark:hover:bg-wa-darkSecondary/60 transition-colors duration-200"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 text-wa-darkText" />
            ) : (
              <Moon className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
