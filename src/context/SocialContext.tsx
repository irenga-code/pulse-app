import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import type { MessageRef } from '@/lib/types';

const UserProfileModal = lazy(() => import('@/components/social/UserProfileModal'));
const MessagesLayer = lazy(() => import('@/components/social/MessagesLayer'));

export type ChatTarget =
  | { view: 'inbox' }
  | { view: 'thread'; otherUserId: string; ref: MessageRef | null };

type SocialValue = {
  /** Open someone's profile card (follow / message / Vibe Rep). */
  openProfile: (userId: string) => void;
  /** Open a private chat with someone, optionally about a post or status. Asks to sign in first. */
  openChat: (userId: string, ref?: MessageRef | null) => void;
  openInbox: () => void;
  /** Unread direct messages, for badges. */
  unread: number;
  refreshUnread: () => void;
};

const noop = () => undefined;
const SocialContext = createContext<SocialValue>({ openProfile: noop, openChat: noop, openInbox: noop, unread: 0, refreshUnread: noop });

let channelCounter = 0;

export function SocialProvider({ children }: { children: ReactNode }) {
  const { user, requireAuth } = useAuth();
  const userId = user?.id ?? null;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatTarget | null>(null);
  const [unread, setUnread] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const refreshUnread = useCallback(() => {
    if (!userId) { setUnread(0); return; }
    api.unreadMessageCount().then(setUnread).catch(() => undefined);
  }, [userId]);

  // unread badge: initial read + live updates (Realtime only delivers rows the signed-in user may see) + a slow safety poll
  useEffect(() => {
    refreshUnread();
    if (!userId) return;
    const soon = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(refreshUnread, 400); };
    const channel = supabase
      .channel(`unread-${++channelCounter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, soon)
      .subscribe();
    const poll = window.setInterval(refreshUnread, 60_000);
    return () => { window.clearTimeout(timer.current); window.clearInterval(poll); supabase.removeChannel(channel); };
  }, [userId, refreshUnread]);

  // sign-out closes anything private
  useEffect(() => { if (!userId) setChat(null); }, [userId]);

  const openProfile = useCallback((id: string) => setProfileId(id), []);
  const openChat = useCallback((other: string, ref?: MessageRef | null) => {
    if (!requireAuth('Sign in to send messages.')) return;
    if (other === userId) return;
    setProfileId(null);
    setChat({ view: 'thread', otherUserId: other, ref: ref ?? null });
  }, [requireAuth, userId]);
  const openInbox = useCallback(() => {
    if (!requireAuth('Sign in to see your messages.')) return;
    setChat({ view: 'inbox' });
  }, [requireAuth]);

  const value = useMemo(() => ({ openProfile, openChat, openInbox, unread, refreshUnread }), [openProfile, openChat, openInbox, unread, refreshUnread]);

  return (
    <SocialContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        {profileId && <UserProfileModal userId={profileId} onClose={() => setProfileId(null)} />}
        {chat && <MessagesLayer target={chat} onNavigate={setChat} onClose={() => { setChat(null); refreshUnread(); }} />}
      </Suspense>
    </SocialContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSocial() {
  return useContext(SocialContext);
}
