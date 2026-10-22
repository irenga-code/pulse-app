import { Settings as SettingsIcon, Moon, Flame, MessageCircle, Megaphone, RotateCcw, Volume2 } from 'lucide-react';
import Modal from '@/components/Modal';
import AccountSection from '@/components/profile/AccountSection';
import { mutedText, bodyText } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings, type Settings } from '@/context/SettingsContext';
import { useNotificationSounds } from '@/hooks/useNotificationSounds';
import { playNotificationSound } from '@/lib/notificationSound';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200 ${
        checked ? 'bg-wa-green' : 'bg-wa-lightBorder dark:bg-wa-darkBorder'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function Row({ icon: Icon, title, description, children }: {
  icon: typeof Moon; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className={`w-5 h-5 flex-shrink-0 ${mutedText}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${bodyText}`}>{title}</p>
        <p className={`text-xs ${mutedText}`}>{description}</p>
      </div>
      {children}
    </div>
  );
}

const sectionTitle = `text-xs font-semibold uppercase tracking-wide ${mutedText}`;
const divider = 'divide-y divide-wa-lightBorder dark:divide-wa-darkBorder';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { settings, setSetting, resetSettings, setThemePreference } = useSettings();
  const [sounds, setSounds] = useNotificationSounds();

  const alertRows: { key: keyof Settings; icon: typeof Moon; title: string; description: string }[] = [
    { key: 'liveVenueAlerts', icon: Flame, title: 'Live venue alerts', description: 'When a venue you follow goes live' },
    { key: 'communityAlerts', icon: MessageCircle, title: 'Community activity', description: 'Comments, reactions, followers and venue posts' },
    { key: 'announcements', icon: Megaphone, title: 'Pulse announcements', description: 'News and tips from Pulse' },
  ];

  return (
    <Modal title="Settings" icon={SettingsIcon} onClose={onClose}>
      <p className={sectionTitle}>Appearance</p>
      <div className={divider}>
        <Row icon={Moon} title="Dark mode" description={theme === 'dark' ? 'On' : 'Off — using light theme'}>
          <Toggle checked={theme === 'dark'} onChange={(on) => setThemePreference(on ? 'dark' : 'light')} label="Dark mode" />
        </Row>
      </div>

      <p className={`${sectionTitle} mt-5`}>Alerts</p>
      <div className={divider}>
        {alertRows.map((r) => (
          <Row key={r.key} icon={r.icon} title={r.title} description={r.description}>
            <Toggle checked={settings[r.key]} onChange={(v) => setSetting(r.key, v)} label={r.title} />
          </Row>
        ))}
        <Row icon={Volume2} title="In-app notification sounds" description="A soft pop for new notifications and messages. Saved on this device.">
          <Toggle
            checked={sounds}
            onChange={(on) => {
              setSounds(on);
              // a preview, which also lets the browser play later sounds
              if (on) playNotificationSound({ force: true });
            }}
            label="In-app notification sounds"
          />
        </Row>
      </div>

      <button
        onClick={resetSettings}
        className={`mt-4 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium border border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green transition-colors ${bodyText}`}
      >
        <RotateCcw className="w-4 h-4" />
        Reset alert preferences
      </button>
      <p className={`text-[11px] text-center mt-2 ${mutedText}`}>
        {user ? 'Saved to your account.' : 'Saved on this device. Sign in to keep them across devices.'}
      </p>

      {user && <AccountSection onClose={onClose} />}
    </Modal>
  );
}
