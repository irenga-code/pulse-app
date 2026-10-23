import { useState } from 'react';
import { ShieldCheck, ArrowLeft, Flag, Users, BadgeCheck, ScrollText, LogIn, Lock, Store, UserCog } from 'lucide-react';
import ReportsPanel from '@/admin/ReportsPanel';
import UsersPanel from '@/admin/UsersPanel';
import VerificationsPanel from '@/admin/VerificationsPanel';
import VenuesPanel from '@/admin/VenuesPanel';
import StaffPanel from '@/admin/StaffPanel';
import LogPanel from '@/admin/LogPanel';
import { Spinner, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

type TabId = 'reports' | 'users' | 'verifications' | 'venues' | 'staff' | 'log';
const tabs: { id: TabId; label: string; icon: typeof Flag }[] = [
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'verifications', label: 'Verifications', icon: BadgeCheck },
  { id: 'venues', label: 'Venues', icon: Store },
  { id: 'staff', label: 'Venue staff', icon: UserCog },
  { id: 'log', label: 'Activity', icon: ScrollText },
];

const goHome = () => { window.location.hash = '#/'; };

function Gate({ icon: Icon, title, text, children }: { icon: typeof Lock; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-20 px-6">
      <Icon className="w-12 h-12 text-wa-quiet mb-3" />
      <h2 className={`text-lg font-bold ${bodyText}`}>{title}</h2>
      <p className={`text-sm mt-1 max-w-sm ${mutedText}`}>{text}</p>
      <div className="flex gap-2 mt-5">{children}</div>
    </div>
  );
}

/** Moderation dashboard at /#/manage (or /admin). Access is enforced by the database (admins table + RLS), not just this screen. */
export default function AdminDashboard() {
  const { ready, user, profile, isAdmin, openAuth } = useAuth();
  const [tab, setTab] = useState<TabId>('reports');

  return (
    <div className="h-viewport w-full overflow-y-auto bg-wa-light dark:bg-wa-dark">
      <header className="sticky top-0 z-30 bg-wa-lightHeader dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 py-3">
          <ShieldCheck className="w-5 h-5 text-wa-greenLight" />
          <span className="text-white font-bold tracking-tight">Pulse Moderation</span>
          {profile && <span className="text-white/70 text-xs ml-1 hidden sm:inline">· {profile.display_name}</span>}
          <button onClick={goHome} className="ml-auto flex items-center gap-1.5 text-white/90 text-xs font-medium hover:text-white">
            <ArrowLeft className="w-4 h-4" />Back to Pulse
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pb-10">
        {!ready ? (
          <Spinner label="Checking access…" />
        ) : !user ? (
          <Gate icon={Lock} title="Sign in required" text="Sign in with an administrator account to open the moderation dashboard.">
            <button onClick={() => openAuth('signin', 'Sign in with your administrator account.')} className={primaryBtn}><LogIn className="w-4 h-4" />Sign in</button>
            <button onClick={goHome} className={ghostBtn}>Back</button>
          </Gate>
        ) : !isAdmin ? (
          <Gate icon={Lock} title="No access" text="This area is only for Pulse administrators.">
            <button onClick={goHome} className={primaryBtn}>Back to Pulse</button>
          </Gate>
        ) : (
          <>
            <nav className="flex gap-1.5 overflow-x-auto py-4" aria-label="Moderation sections">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                      active ? 'bg-wa-green text-white' : 'bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightTextSecondary dark:text-wa-darkTextSecondary border border-wa-lightBorder dark:border-wa-darkBorder'
                    }`}
                  >
                    <Icon className="w-4 h-4" />{t.label}
                  </button>
                );
              })}
            </nav>
            {tab === 'reports' && <ReportsPanel />}
            {tab === 'users' && <UsersPanel />}
            {tab === 'verifications' && <VerificationsPanel />}
            {tab === 'venues' && <VenuesPanel />}
            {tab === 'staff' && <StaffPanel />}
            {tab === 'log' && <LogPanel />}
          </>
        )}
      </div>
    </div>
  );
}
