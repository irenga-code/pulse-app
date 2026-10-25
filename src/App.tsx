import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Camera, Moon, Sun } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { SettingsProvider, useSettings } from '@/context/SettingsContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SocialProvider, useSocial } from '@/context/SocialContext';
import { VenueLibraryProvider } from '@/context/VenueLibraryContext';
import { VenueVibesProvider } from '@/context/VenueVibesContext';
import { QuickSnapProvider, useQuickSnap } from '@/camera/QuickSnapContext';
import AuthModals from '@/components/auth/AuthModals';
import NotificationSounds from '@/components/NotificationSounds';
import AdminDashboard from '@/admin/AdminDashboard';
import { useHashRoute, isAdminRoute } from '@/hooks/useHashRoute';
import { useLiveVenueCount } from '@/hooks/useVenues';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { warmUp } from '@/lib/warmup';
import Header from '@/components/Header';
import LeftRail from '@/components/nav/LeftRail';
import MobileNav from '@/components/nav/MobileNav';
import { normalizeSection, type SectionId } from '@/components/nav/sections';
import ChatsTab from '@/tabs/ChatsTab';
import CallsTab from '@/tabs/CallsTab';
import StatusTab from '@/tabs/StatusTab';
import ChannelsTab from '@/tabs/ChannelsTab';
import UpdatesTab from '@/tabs/UpdatesTab';
import CommunityTab from '@/tabs/CommunityTab';
import CatalogTab from '@/tabs/CatalogTab';
import BroadcastsTab from '@/tabs/BroadcastsTab';
import MediaTab from '@/tabs/MediaTab';
import ProfileTab from '@/tabs/ProfileTab';

const SharedPostModal = lazy(() => import('@/components/community/SharedPostModal'));
const SettingsModal = lazy(() => import('@/components/profile/SettingsModal'));

/** Desktop top bar: live count, Quick-Snap launcher and theme. (Phones get the same in the green Header.) */
function DesktopTopBar() {
  const liveCount = useLiveVenueCount();
  const { openQuickSnap } = useQuickSnap();
  const { theme } = useTheme();
  const { setThemePreference } = useSettings();
  return (
    <div className="hidden md:flex items-center gap-2 px-6 py-2.5 bg-wa-lightPanel dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder">
      <span className="mr-3"><BrandLogo /></span>
      {liveCount > 0 && (
        <>
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-wa-live animate-pulse-dot" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-wa-live" />
          </span>
          <span className="text-sm font-semibold text-wa-live">LIVE · {liveCount}</span>
        </>
      )}
      <span className="flex-1" />
      <button onClick={() => openQuickSnap()} className="flex items-center gap-2 rounded-full bg-wa-green text-white px-4 py-1.5 text-sm font-semibold hover:bg-wa-greenDark transition-colors"
        aria-label="Quick-Snap camera" title="Tap for photo, hold for video">
        <Camera className="w-4 h-4" />Quick-Snap
      </button>
      <button onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme"
        className="p-2 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60">
        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>
    </div>
  );
}

function MainApp({ sharedPostId }: { sharedPostId?: string }) {
  const desktop = useIsDesktop();
  const [picked, setPicked] = useState<SectionId>(sharedPostId ? 'communities' : 'chats');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { user } = useAuth();
  const { unread } = useSocial();
  const userId = user?.id ?? null;
  useEffect(() => { warmUp(userId); }, [userId]);

  // Status + Channels share one Updates screen on phones; resizing keeps you on the matching screen
  const section = normalizeSection(picked, !desktop);
  const go = useCallback((id: SectionId) => setPicked(id), []);
  const badges = { chats: unread };

  const renderSection = () => {
    switch (section) {
      case 'chats': return <ChatsTab />;
      case 'calls': return <CallsTab />;
      case 'status': return <StatusTab />;
      case 'channels': return <ChannelsTab onCreate={() => go('broadcasts')} />;
      case 'updates': return <UpdatesTab onCreate={() => go('broadcasts')} />;
      case 'communities': return <CommunityTab />;
      case 'catalog': return <CatalogTab />;
      case 'broadcasts': return <BroadcastsTab />;
      case 'media': return <MediaTab />;
      case 'profile': return <ProfileTab onNavigate={go} />;
    }
  };

  return (
    <>
      <div className="h-viewport w-full overflow-hidden bg-wa-light dark:bg-wa-dark flex flex-col md:flex-row transition-colors duration-300">
        {desktop && <LeftRail active={section} onSelect={go} onSettings={() => setSettingsOpen(true)} badges={badges} />}

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Mobile header (hidden on desktop) */}
          <Header />
          <DesktopTopBar />

          {/* Section content: a GPU-friendly fade/slide on every switch */}
          <main className="flex-1 flex flex-col min-h-0 overflow-y-auto overscroll-y-contain">
            <div key={section} className="flex-1 flex flex-col min-h-0 animate-section-in">
              {renderSection()}
            </div>
          </main>

          {/* Mobile bottom nav (hidden on desktop) */}
          <MobileNav active={section} onSelect={go} badges={badges} />
        </div>
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {sharedPostId && (
        <Suspense fallback={null}>
          <SharedPostModal postId={sharedPostId} onClose={() => { window.location.hash = '#/'; }} />
        </Suspense>
      )}
    </>
  );
}

function Router() {
  const route = useHashRoute();
  if (isAdminRoute(route)) return <AdminDashboard />;
  const shared = /^\/post\/([0-9a-f-]{36})$/i.exec(route);
  return <MainApp sharedPostId={shared?.[1]} />;
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <SettingsProvider>
            <VenueLibraryProvider>
              <VenueVibesProvider>
                <QuickSnapProvider>
                  <SocialProvider>
                    <Router />
                  </SocialProvider>
                </QuickSnapProvider>
                <NotificationSounds />
                <AuthModals />
              </VenueVibesProvider>
            </VenueLibraryProvider>
          </SettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;