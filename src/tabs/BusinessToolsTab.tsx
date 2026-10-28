import { useState } from 'react';
import { ChevronRight, CircleHelp, Megaphone, ShoppingBag, Store, Tags, TrendingUp, Zap } from 'lucide-react';
import SectionHeader from '@/components/nav/SectionHeader';
import BusinessProfileModal from '@/components/profile/BusinessProfileModal';
import CreateAdView from '@/components/business/CreateAdView';
import { mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { SectionId } from '@/components/nav/sections';

type Tool = { label: string; hint: string; icon: typeof Store; onClick: () => void };

/** WhatsApp Business "Business tools": profile, ways to grow, ways to organise chats, and help. */
export default function BusinessToolsTab({ onNavigate }: { onNavigate: (id: SectionId) => void }) {
  const { user, openAuth } = useAuth();
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const soon = (what: string) => () => show(`${what} is coming soon to Pulse`);

  const groups: { title?: string; tools: Tool[] }[] = [
    { tools: [
      { label: 'Business profile', hint: 'Manage address, hours and websites', icon: Store, onClick: () => (user ? setEditing(true) : openAuth('signin')) },
    ] },
    { title: 'Grow your business', tools: [
      { label: 'Catalog', hint: 'Show products and services', icon: ShoppingBag, onClick: soon('Catalog') },
      { label: 'Advertise', hint: 'Create ads that lead to chats', icon: TrendingUp, onClick: () => (user ? setAdvertising(true) : openAuth('signin')) },
      { label: 'Business broadcast', hint: 'Send one update to all your channel followers', icon: Megaphone, onClick: () => onNavigate('broadcasts') },
    ] },
    { title: 'Organize your chats', tools: [
      { label: 'Quick replies', hint: 'Reuse frequent messages', icon: Zap, onClick: soon('Quick replies') },
      { label: 'Lists', hint: 'Sort chats into unread, favourites and more', icon: Tags, onClick: () => onNavigate('chats') },
    ] },
    { tools: [
      { label: 'Business help center', hint: 'Get help and answers', icon: CircleHelp, onClick: soon('Business help center') },
    ] },
  ];

  if (advertising) return <CreateAdView onBack={() => setAdvertising(false)} />;

  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Business tools" camera={false} />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-6">
        <div className="max-w-2xl space-y-4">
          {groups.map((g, gi) => (
            <section key={g.title ?? gi} aria-label={g.title}>
              {g.title && <h2 className={`px-1 pb-1.5 text-sm font-medium ${mutedText}`}>{g.title}</h2>}
              <div className="bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder overflow-hidden">
                {g.tools.map((t, i) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.label} type="button" onClick={t.onClick}
                      className={`flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/50 transition-colors ${i ? 'border-t border-wa-lightBorder dark:border-wa-darkBorder' : ''}`}>
                      <Icon className={`w-5 h-5 flex-shrink-0 ${mutedText}`} />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-[15px] ${bodyText}`}>{t.label}</span>
                        <span className={`block text-xs truncate ${mutedText}`}>{t.hint}</span>
                      </span>
                      <ChevronRight className={`w-4 h-4 flex-shrink-0 ${mutedText}`} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
      {editing && <BusinessProfileModal onClose={() => setEditing(false)} />}
    </div>
  );
}
