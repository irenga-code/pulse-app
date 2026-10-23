import { useState } from 'react';
import { Bell, ChevronRight, Settings, LogOut, Bookmark, BadgeCheck, Store, ShieldCheck, UserCog, LogIn, UserRound, Mail, BookmarkCheck, Flame, PlusCircle } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import NotificationsModal from '@/components/profile/NotificationsModal';
import SettingsModal from '@/components/profile/SettingsModal';
import SavedVenuesModal from '@/components/profile/SavedVenuesModal';
import EditProfileModal from '@/components/profile/EditProfileModal';
import VerificationModal from '@/components/profile/VerificationModal';
import MyVenueModal from '@/components/profile/MyVenueModal';
import RegisterVenueModal from '@/components/profile/RegisterVenueModal';
import SavedPostsModal from '@/components/profile/SavedPostsModal';
import { Stat } from '@/components/social/Stat';
import { primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { useNotifications } from '@/hooks/useNotifications';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import { api } from '@/lib/apiClient';
import { userKey, revalidateAll } from '@/lib/cache';
import type { Venue } from '@/lib/types';

type ModalId = 'notifications' | 'settings' | 'saved' | 'savedPosts' | 'edit' | 'verify' | 'venue' | 'register' | null;

type MenuItem = { label: string; icon: typeof Bell; onClick: () => void; badge?: number; href?: string };

function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function ProfileTab() {
  const [modal, setModal] = useState<ModalId>(null);
  const [registered, setRegistered] = useState<Venue | null>(null);
  const closeModal = () => {
    setModal(null);
    setRegistered(null);
  };
  const { user, profile, isAdmin, openAuth, signOut } = useAuth();
  const { show } = useToast();
  const feed = useNotifications();
  const { openInbox, unread } = useSocial();
  const stats = useAsync(() => (user ? api.profileStats(user.id) : Promise.resolve(null)), [], user ? userKey(user.id, 'profile-stats') : null);
  const managed = useAsync(() => (user ? api.managedVenueIds(user.id) : Promise.resolve([] as string[])), [], user ? userKey(user.id, 'managed-venues') : null);
  const managedCount = (managed.data ?? []).length;

  const handleSignOut = async () => {
    try {
      await signOut();
      show('Signed out');
    } catch {
      show('Could not sign out. Please try again.', 'error');
    }
  };

  const menuItems: MenuItem[] = [
    { label: 'Notifications', icon: Bell, onClick: () => setModal('notifications'), badge: feed.unreadCount },
    { label: 'Messages', icon: Mail, onClick: openInbox, badge: unread },
    { label: 'Saved posts', icon: BookmarkCheck, onClick: () => setModal('savedPosts') },
    { label: 'Saved venues', icon: Bookmark, onClick: () => setModal('saved') },
    { label: 'Settings', icon: Settings, onClick: () => setModal('settings') },
  ];
  // Host / Venue accounts get My venues before their first club, to add one (migration 14)
  const canLink = profile?.status === 'active' && (profile.account_type === 'host' || profile.account_type === 'venue');
  if (user && (managedCount > 0 || canLink)) menuItems.push({ label: managedCount === 1 ? 'My venue' : 'My venues', icon: Store, onClick: () => setModal('venue') });
  if (user) menuItems.push({ label: 'Register a club', icon: PlusCircle, onClick: () => setModal('register') });
  if (user) menuItems.push({ label: 'Request verification', icon: BadgeCheck, onClick: () => setModal('verify') });
  if (isAdmin) menuItems.push({ label: 'Admin dashboard', icon: ShieldCheck, onClick: () => { window.location.hash = '#/manage'; } });

  return (
    <div className="flex flex-col h-full bg-wa-light dark:bg-wa-dark">
      <div className="px-4 md:px-8 pt-4 pb-2">
        <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-6">
        <div className="max-w-2xl">
          {/* Profile card */}
          <div className="bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-5 border border-wa-lightBorder dark:border-wa-darkBorder mt-2 animate-slide-up">
            {user && profile ? (
              <>
                <div className="flex items-center gap-4">
                  <Avatar name={profile.display_name} url={profile.avatar_url} size={64} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className={`text-lg font-bold ${bodyText}`}>{profile.display_name}</h2>
                      <RoleBadge accountType={profile.account_type} verified={profile.is_verified} admin={isAdmin} />
                    </div>
                    <p className={`text-xs mt-0.5 ${mutedText}`}>Member since {monthYear(profile.created_at)}</p>
                    {profile.status !== 'active' && (
                      <p className="text-xs font-semibold text-wa-live mt-1">Account {profile.status}</p>
                    )}
                  </div>
                </div>
                {profile.bio && <p className={`text-sm mt-3 leading-relaxed ${bodyText}`}>{profile.bio}</p>}
                <div className="flex rounded-2xl py-3 mt-4 bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder" data-testid="my-stats">
                  <Stat label="Followers" value={stats.data?.follower_count ?? 0} />
                  <Stat label="Following" value={stats.data?.following_count ?? 0} />
                  <Stat label="Posts" value={stats.data?.post_count ?? 0} />
                  <Stat label="Vibe Rep" value={stats.data?.vibe_rep ?? 0} icon={<Flame className="w-4 h-4 text-orange-500" />} />
                </div>
                <button onClick={() => setModal('edit')} className={`${ghostBtn} mt-4`}>
                  <UserCog className="w-4 h-4" />
                  Edit profile
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-2">
                <div className="w-16 h-16 rounded-full bg-wa-light dark:bg-wa-dark flex items-center justify-center mb-3">
                  <UserRound className="w-8 h-8 text-wa-quiet" />
                </div>
                <h2 className={`text-lg font-bold ${bodyText}`}>Join Pulse</h2>
                <p className={`text-sm mt-1 max-w-xs ${mutedText}`}>
                  Follow venues, get live alerts, save your favourites and join the conversation.
                </p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => openAuth('signup')} className={primaryBtn}>Create account</button>
                  <button onClick={() => openAuth('signin')} className={ghostBtn}><LogIn className="w-4 h-4" />Sign in</button>
                </div>
              </div>
            )}
          </div>

          {/* Menu */}
          <div className="mt-4 bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder overflow-hidden">
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className={`flex items-center gap-3 w-full px-4 py-3.5 hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/50 transition-colors text-left ${
                    idx !== menuItems.length - 1 ? 'border-b border-wa-lightBorder dark:border-wa-darkBorder' : ''
                  }`}
                >
                  <Icon className={`w-5 h-5 flex-shrink-0 ${mutedText}`} />
                  <span className={`text-sm font-medium flex-1 ${bodyText}`}>{item.label}</span>
                  {!!item.badge && item.badge > 0 && (
                    <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-wa-green text-white text-[11px] font-bold flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                  <ChevronRight className={`w-4 h-4 ${mutedText}`} />
                </button>
              );
            })}
          </div>

          {user && (
            <button
              onClick={handleSignOut}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl py-3.5 border border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-live/40 transition-colors"
            >
              <LogOut className="w-5 h-5 text-wa-live" />
              <span className="text-sm font-semibold text-wa-live">Sign out</span>
            </button>
          )}

          <p className={`text-center text-xs mt-6 ${mutedText}`}>Pulse v1.0 · Made for Kampala</p>
        </div>
      </div>

      {modal === 'notifications' && <NotificationsModal onClose={closeModal} feed={feed} />}
      {modal === 'settings' && <SettingsModal onClose={closeModal} />}
      {modal === 'saved' && <SavedVenuesModal onClose={closeModal} />}
      {modal === 'savedPosts' && <SavedPostsModal onClose={closeModal} />}
      {modal === 'edit' && <EditProfileModal onClose={closeModal} />}
      {modal === 'verify' && <VerificationModal onClose={closeModal} />}
      {modal === 'venue' && <MyVenueModal onClose={closeModal} initialVenue={registered ?? undefined} />}
      {modal === 'register' && (
        <RegisterVenueModal
          onClose={closeModal}
          onRegistered={(venue) => {
            // refresh venue lists and "My venues", then open the new venue so they can manage it right away
            revalidateAll();
            managed.reload();
            setRegistered(venue);
            setModal('venue');
          }}
        />
      )}
    </div>
  );
}
