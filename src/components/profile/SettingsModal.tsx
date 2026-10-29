import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ArrowLeft, User, KeyRound, Bell, Palette, Info, ChevronRight, Monitor, Moon, Sun, Check, BellRing, Volume2,
  MessageCircle, Megaphone, RotateCcw, FileText, ShieldCheck, LogIn, Sparkles,
} from 'lucide-react';
import Avatar from '@/components/Avatar';
import BrandLogo from '@/components/BrandLogo';
import ProfileForm from '@/components/profile/ProfileForm';
import AccountSection from '@/components/profile/AccountSection';
import MyRolesSection from '@/components/profile/MyRolesSection';
import { SettingsGroup, SettingsRow, Toggle, settingsCard } from '@/components/settings/SettingsUi';
import { primaryBtn, mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useTheme, ACCENTS, type ThemePreference } from '@/context/ThemeContext';
import { useSettings, type Settings } from '@/context/SettingsContext';
import { useNotificationSounds } from '@/hooks/useNotificationSounds';
import { playNotificationSound } from '@/lib/notificationSound';
import { lockBodyScroll } from '@/lib/scrollLock';
import {
  desktopNotificationsSupported, getDesktopPrefs, notificationPermission, setDesktopNotifications, subscribeDesktopPrefs,
} from '@/lib/desktopNotifications';

export type SettingsSection = 'profile' | 'account' | 'notifications' | 'appearance' | 'about';
export const APP_VERSION = '1.0.0';

const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: typeof User }[] = [
  { id: 'profile', label: 'Profile', hint: 'Photo, name and about', icon: User },
  { id: 'account', label: 'Account', hint: 'Phone number, privacy, security', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', hint: 'Messages, sounds, alerts', icon: Bell },
  { id: 'appearance', label: 'Appearance', hint: 'Theme and accent colour', icon: Palette },
  { id: 'about', label: 'Help & About', hint: 'Version, terms, privacy', icon: Info },
];
const NEEDS_ACCOUNT: SettingsSection[] = ['profile', 'account'];

function SignInPrompt({ what, onSignIn }: { what: string; onSignIn: () => void }) {
  return (
    <div className={`${settingsCard} p-6 text-center`}>
      <p className={`text-sm ${bodyText}`}>Sign in to manage your {what}.</p>
      <button type="button" onClick={onSignIn} className={`${primaryBtn} mt-4`}><LogIn className="w-4 h-4" />Sign in</button>
    </div>
  );
}

function ProfilePane() {
  return (
    <div className="space-y-6">
      <div className={`${settingsCard} p-5`}><ProfileForm large /></div>
      <MyRolesSection />
    </div>
  );
}

function NotificationsPane() {
  const { user } = useAuth();
  const { settings, setSetting, resetSettings } = useSettings();
  const [sounds, setSounds] = useNotificationSounds();
  const desktop = useSyncExternalStore(subscribeDesktopPrefs, getDesktopPrefs, getDesktopPrefs);
  const [blocked, setBlocked] = useState(() => notificationPermission() === 'denied');
  const supported = desktopNotificationsSupported();

  const alertRows: { key: keyof Settings; icon: typeof Bell; title: string; description: string }[] = [
    { key: 'communityAlerts', icon: MessageCircle, title: 'Community activity', description: 'Comments, reactions, new followers and channel posts' },
    { key: 'announcements', icon: Megaphone, title: 'Pulse announcements', description: 'News and tips from Pulse' },
  ];

  return (
    <div className="space-y-6">
      <SettingsGroup title="On this device">
        <SettingsRow icon={BellRing} title="Push notifications"
          description={!supported ? 'This browser does not support notifications.'
            : blocked ? 'Blocked in your browser. Allow notifications for this site in the browser settings, then try again.'
            : 'Show a system notification for new messages and alerts while Pulse is in the background.'}
          trailing={<Toggle checked={desktop.enabled && !blocked} disabled={!supported} label="Push notifications"
            onChange={async (on) => { const ok = await setDesktopNotifications(on); setBlocked(on && !ok && notificationPermission() === 'denied'); }} />} />
        <SettingsRow icon={Volume2} title="Message sounds" description="A soft pop for new messages and notifications"
          trailing={<Toggle checked={sounds} label="Message sounds" onChange={(on) => { setSounds(on); if (on) playNotificationSound({ force: true }); }} />} />
      </SettingsGroup>

      <SettingsGroup title="Alerts">
        {alertRows.map((r) => (
          <SettingsRow key={r.key} icon={r.icon} title={r.title} description={r.description}
            trailing={<Toggle checked={settings[r.key]} onChange={(v) => setSetting(r.key, v)} label={r.title} />} />
        ))}
        <SettingsRow icon={RotateCcw} title="Reset alert preferences" onClick={resetSettings} trailing={<span />} />
      </SettingsGroup>
      <p className={`text-[11px] px-1 ${mutedText}`}>
        {user ? 'Alerts are saved to your account; push and sounds are saved on this device.' : 'Saved on this device. Sign in to keep alerts across devices.'}
      </p>
    </div>
  );
}

function AppearancePane() {
  const { preference, accent, setAccent, activeAccent } = useTheme();
  const { setThemePreference } = useSettings();
  const modes: { id: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
    { id: 'dark', label: 'Dark', icon: Moon, hint: 'Default' },
    { id: 'light', label: 'Light', icon: Sun, hint: 'Clean white' },
    { id: 'system', label: 'System default', icon: Monitor, hint: 'Follows your device' },
  ];

  return (
    <div className="space-y-6">
      <SettingsGroup title="Mode">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 p-4">
          {modes.map((m) => {
            const on = preference === m.id;
            const Icon = m.icon;
            return (
              <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => setThemePreference(m.id)}
                className={`relative flex flex-col items-center gap-2 rounded-xl border px-2 py-4 transition-colors ${
                  on ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green/50'}`}>
                {/* a tiny preview of the theme */}
                <span className={`w-full h-12 rounded-lg overflow-hidden flex border ${m.id === 'light' ? 'bg-slate-50 border-slate-200' : m.id === 'dark' ? 'bg-[#161717] border-[#2e2f2f]' : 'bg-gradient-to-r from-slate-50 from-50% to-[#161717] to-50% border-slate-300 dark:border-wa-darkBorder'}`} aria-hidden="true">
                  <span className={`w-1/4 h-full ${m.id === 'light' ? 'bg-white' : m.id === 'dark' ? 'bg-[#1d1f1f]' : 'bg-white'}`} />
                </span>
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${on ? 'text-wa-green' : bodyText}`}><Icon className="w-4 h-4" />{m.label}</span>
                <span className={`text-[11px] ${mutedText}`}>{m.hint}</span>
                {on && <Check className="absolute top-2 right-2 w-4 h-4 text-wa-green" />}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Primary accent colour">
        <div role="radiogroup" aria-label="Accent colour" className="p-4 space-y-3">
          <button type="button" role="radio" aria-checked={accent === 'auto'} onClick={() => setAccent('auto')}
            className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              accent === 'auto' ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green/50'}`}>
            <span className="w-8 h-8 rounded-full flex-shrink-0 bg-[#10b981]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={`flex items-center gap-1.5 text-sm font-semibold ${bodyText}`}><Sparkles className="w-3.5 h-3.5 text-wa-green" />Pulse green (default)</span>
              <span className={`block text-[11px] ${mutedText}`}>Emerald Green #10b981 in dark and light mode</span>
            </span>
            {accent === 'auto' && <Check className="w-4 h-4 text-wa-green" />}
          </button>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {ACCENTS.map((a) => {
              const on = accent === a.id;
              return (
                <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => setAccent(a.id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-colors ${
                    on ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green/50'}`}>
                  <span className="w-9 h-9 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-white dark:ring-offset-wa-darkPanel"
                    style={{ backgroundColor: a.swatch, ['--tw-ring-color' as string]: on ? a.swatch : 'transparent' }} aria-hidden="true">
                    {on && <Check className={`w-4 h-4 ${a.id === 'yellow' || a.id === 'softpink' || a.id === 'vibrant' ? 'text-slate-900' : 'text-white'}`} strokeWidth={3} />}
                  </span>
                  <span className={`text-xs font-medium ${bodyText}`}>{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsGroup>

      <div className={`${settingsCard} p-4 flex items-center gap-3`}>
        <span className="w-10 h-10 rounded-full bg-wa-green text-white flex items-center justify-center"><Check className="w-5 h-5" /></span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${bodyText}`}>Preview</span>
          <span className={`block text-xs ${mutedText}`}>Buttons, badges and highlights use {ACCENTS.find((a) => a.id === activeAccent)?.label}.</span>
        </span>
        <span className="rounded-full bg-wa-green/15 text-wa-green px-2.5 py-1 text-xs font-semibold">Active</span>
      </div>
    </div>
  );
}

function AboutPane() {
  const [open, setOpen] = useState<'terms' | 'privacy' | null>(null);
  return (
    <div className="space-y-6">
      <div className={`${settingsCard} p-6 flex flex-col items-center text-center`}>
        <BrandLogo size="lg" />
        <p className={`text-sm mt-1 ${mutedText}`}>Version v{APP_VERSION}</p>
      </div>
      <SettingsGroup title="Legal">
        <SettingsRow icon={FileText} title="Terms of Service" onClick={() => setOpen(open === 'terms' ? null : 'terms')} expanded={open === 'terms'} />
        {open === 'terms' && (
          <div className={`px-4 pb-4 text-xs leading-relaxed space-y-2 ${mutedText}`}>
            <p>Be respectful. No harassment, hate, threats, scams, spam or illegal content. Do not post other people's private information or images without consent.</p>
            <p>You own what you post and give Pulse permission to show it to the people you share it with. Moderators can remove content and suspend or ban accounts that break these rules.</p>
            <p>Statuses and snaps disappear after 24 hours; vanish-mode messages after they are read. You can delete your account at any time in Settings &gt; Account.</p>
          </div>
        )}
        <SettingsRow icon={ShieldCheck} title="Privacy Policy" onClick={() => setOpen(open === 'privacy' ? null : 'privacy')} expanded={open === 'privacy'} />
        {open === 'privacy' && (
          <div className={`px-4 pb-4 text-xs leading-relaxed space-y-2 ${mutedText}`}>
            <p>Your phone number is private: only you can see it, and people can find you only if they already know it. Your display name, photo and about are public.</p>
            <p>Voice messages are stored privately and only the two people in a chat can play them. Location on snaps is a rough area label, never your exact coordinates.</p>
            <p>Deleting your account removes your profile and everything you posted, commented, saved or followed.</p>
          </div>
        )}
      </SettingsGroup>
      <p className={`text-[11px] text-center ${mutedText}`}>© {new Date().getFullYear()} Pulse</p>
    </div>
  );
}

/** WhatsApp-desktop-style Settings: sections on the left, the chosen one on the right (one at a time on phones). */
export default function SettingsModal({ onClose, initialSection }: { onClose: () => void; initialSection?: SettingsSection }) {
  const { user, profile, openAuth } = useAuth();
  // phones open on the list; desktop opens on a section straight away
  const [section, setSection] = useState<SettingsSection | null>(initialSection ?? null);
  const desktopDefault: SettingsSection = user ? 'profile' : 'appearance';
  const shown = section ?? desktopDefault;

  useEffect(() => lockBodyScroll(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const signIn = () => { onClose(); openAuth('signin'); };
  const current = SECTIONS.find((s) => s.id === shown)!;
  const pane = !user && NEEDS_ACCOUNT.includes(shown) ? <SignInPrompt what={current.label.toLowerCase()} onSignIn={signIn} />
    : shown === 'profile' ? <ProfilePane />
    : shown === 'account' ? <AccountSection onClose={onClose} />
    : shown === 'notifications' ? <NotificationsPane />
    : shown === 'appearance' ? <AppearancePane />
    : <AboutPane />;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Settings"
        className="relative w-full md:max-w-5xl h-viewport md:h-[min(760px,calc(100vh-3rem))] flex md:rounded-2xl overflow-hidden shadow-2xl bg-wa-lightSecondary dark:bg-wa-dark md:border border-wa-lightBorder dark:border-wa-darkBorder">
        <button type="button" onClick={onClose} aria-label="Close settings"
          className={`absolute top-3 right-3 z-10 p-2 rounded-full hover:bg-black/5 dark:hover:bg-wa-darkHover ${mutedText}`}>
          <X className="w-5 h-5" />
        </button>

        {/* left: sections */}
        <nav aria-label="Settings sections"
          className={`${section ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-shrink-0 flex-col bg-wa-lightPanel dark:bg-wa-darkPanel md:border-r border-wa-lightBorder dark:border-wa-darkBorder`}>
          <h2 className={`text-xl font-bold px-5 pt-5 pb-4 ${bodyText}`}>Settings</h2>
          {user && profile ? (
            <button type="button" onClick={() => setSection('profile')}
              className="flex items-center gap-3 mx-3 mb-2 px-3 py-3 rounded-xl text-left hover:bg-black/[0.03] dark:hover:bg-wa-darkHover">
              <Avatar name={profile.display_name} url={profile.avatar_url} size={52} />
              <span className="min-w-0 flex-1">
                <span className={`block text-base font-semibold truncate ${bodyText}`}>{profile.display_name}</span>
                <span className={`block text-xs truncate ${mutedText}`}>{profile.bio || 'Hey there! I am using Pulse.'}</span>
              </span>
            </button>
          ) : (
            <button type="button" onClick={signIn} className={`${primaryBtn} mx-5 mb-3`}><LogIn className="w-4 h-4" />Sign in</button>
          )}
          <ul className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const on = shown === s.id;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => setSection(s.id)} aria-current={on ? 'page' : undefined}
                    className={`relative w-full flex items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors ${
                      on ? 'md:bg-wa-green/10 dark:md:bg-wa-darkHover' : 'hover:bg-black/[0.03] dark:hover:bg-wa-darkHover'}`}>
                    {on && <span className="hidden md:block absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-full bg-wa-green" aria-hidden="true" />}
                    <Icon className={`w-5 h-5 flex-shrink-0 ${on ? 'md:text-wa-green' : ''} ${mutedText}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-medium ${bodyText}`}>{s.label}</span>
                      <span className={`block text-xs truncate ${mutedText}`}>{s.hint}</span>
                    </span>
                    <ChevronRight className={`w-4 h-4 md:hidden ${mutedText}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* right: the chosen section */}
        <section aria-label={current.label} className={`${section ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
          <header className="flex items-center gap-2 px-4 md:px-8 pt-4 pb-3 pr-14">
            <button type="button" onClick={() => setSection(null)} aria-label="Back to settings" className={`md:hidden p-2 -ml-2 rounded-full hover:bg-black/5 dark:hover:bg-wa-darkHover ${bodyText}`}>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className={`text-lg md:text-xl font-bold ${bodyText}`}>{current.label}</h2>
          </header>
          <div key={shown} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-8 animate-section-in">
            <div className="max-w-2xl">{pane}</div>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
