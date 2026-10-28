import { Sun, Moon, Activity, Camera } from 'lucide-react';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { useTheme } from '@/context/ThemeContext';
import { useSettings } from '@/context/SettingsContext';

export default function Header() {
  const { theme } = useTheme();
  const { setThemePreference } = useSettings();
  const { openQuickSnap } = useQuickSnap();

  return (
    <header className="md:hidden sticky top-0 z-30 bg-wa-lightHeader dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder transition-colors duration-300">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Activity className="w-5 h-5 text-wa-greenLight" strokeWidth={2.5} />
          <span className="text-white text-lg font-bold tracking-tight">Pulse</span>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-3">
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
