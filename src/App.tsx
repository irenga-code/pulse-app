<<<<<<< HEAD
import { lazy, Suspense, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ThemeProvider } from '@/context/ThemeContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SocialProvider } from '@/context/SocialContext';
import { VenueLibraryProvider } from '@/context/VenueLibraryContext';
import { VenueVibesProvider } from '@/context/VenueVibesContext';
import AuthModals from '@/components/auth/AuthModals';
import AdminDashboard from '@/admin/AdminDashboard';
import { useHashRoute, isAdminRoute } from '@/hooks/useHashRoute';
import { useLiveVenueCount } from '@/hooks/useVenues';
import { warmUp } from '@/lib/warmup';
=======
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import ManagerPortal from '@/manager/ManagerPortal';
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
import Header from '@/components/Header';
import BottomNav, { SidebarBranding, type TabId } from '@/components/BottomNav';
import VenuesTab from '@/tabs/VenuesTab';
import TonightTab from '@/tabs/TonightTab';
import CommunityTab from '@/tabs/CommunityTab';
import SearchTab from '@/tabs/SearchTab';
import ProfileTab from '@/tabs/ProfileTab';

<<<<<<< HEAD
const SharedPostModal = lazy(() => import('@/components/community/SharedPostModal'));

function MainApp({ sharedPostId }: { sharedPostId?: string }) {
  const [activeTab, setActiveTab] = useState<TabId>(sharedPostId ? 'community' : 'venues');
  const [cityOpen, setCityOpen] = useState(false);
  const liveCount = useLiveVenueCount();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => { warmUp(userId); }, [userId]);
=======
// Venue managers/hosts sign in at /#/manage. Nothing in the public navigation links here.
const MANAGER_HASH = '#/manage';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('venues');
  const [cityOpen, setCityOpen] = useState(false);
  const [isManagerRoute, setIsManagerRoute] = useState(() => window.location.hash === MANAGER_HASH);

  useEffect(() => {
    const onHashChange = () => setIsManagerRoute(window.location.hash === MANAGER_HASH);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9

  const renderTab = () => {
    switch (activeTab) {
      case 'tonight':
        return <TonightTab />;
      case 'community':
        return <CommunityTab />;
      case 'venues':
        return <VenuesTab />;
      case 'search':
        return <SearchTab />;
      case 'profile':
        return <ProfileTab />;
    }
  };

<<<<<<< HEAD
  return (
    <>
      <div className="h-screen w-full overflow-hidden bg-wa-light dark:bg-wa-dark flex flex-col md:flex-row transition-colors duration-300">
=======
  if (isManagerRoute) {
    return (
      <ThemeProvider>
        <AuthProvider>
          <ManagerPortal />
        </AuthProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="min-min-h-screen w-full overflow-y-auto bg-wa-light dark:bg-wa-dark flex flex-col md:flex-row transition-colors duration-300">
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-72 lg:w-80 flex-col bg-wa-lightPanel dark:bg-wa-darkPanel border-r border-wa-lightBorder dark:border-wa-darkBorder flex-shrink-0">
          <SidebarBranding />

          {/* City selector */}
          <div className="px-5 py-3 border-b border-wa-lightBorder dark:border-wa-darkBorder relative">
            <button
              onClick={() => setCityOpen((v) => !v)}
              className="flex items-center gap-1.5 text-wa-lightText dark:text-wa-darkText text-sm font-medium"
            >
              <span className="h-2 w-2 rounded-full bg-wa-live animate-pulse-dot" />
              Kampala
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${cityOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {cityOpen && (
              <div className="absolute top-full left-5 mt-2 w-44 bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-lg shadow-xl border border-wa-lightBorder dark:border-wa-darkBorder py-1 animate-fade-in z-40">
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

          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} variant="sidebar" />
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile header (hidden on desktop) */}
          <Header />

          {/* Desktop top bar */}
          <div className="hidden md:flex items-center justify-between px-6 lg:px-8 py-3 bg-wa-lightPanel dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder">
            <div className="flex items-center gap-2">
<<<<<<< HEAD
              {liveCount > 0 && (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-wa-live animate-pulse-dot" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-wa-live" />
                  </span>
                  <span className="text-sm font-semibold text-wa-live">LIVE · {liveCount}</span>
                </>
              )}
              <span className={`text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary ${liveCount > 0 ? 'ml-2' : ''}`}>
=======
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-wa-live animate-pulse-dot" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-wa-live" />
              </span>
              <span className="text-sm font-semibold text-wa-live">LIVE</span>
              <span className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary ml-2">
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
                Real-time Kampala nightlife
              </span>
            </div>
          </div>

          {/* Tab content */}
          <main className="flex-1 flex flex-col overflow-y-auto">
            <div key={activeTab} className="flex-1 flex flex-col animate-fade-in">
              {renderTab()}
            </div>
          </main>

          {/* Mobile bottom nav (hidden on desktop) */}
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} variant="bottom" />
        </div>
      </div>
<<<<<<< HEAD
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
                <SocialProvider>
                  <Router />
                </SocialProvider>
                <AuthModals />
              </VenueVibesProvider>
            </VenueLibraryProvider>
          </SettingsProvider>
        </AuthProvider>
      </ToastProvider>
=======
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
    </ThemeProvider>
  );
}

export default App;