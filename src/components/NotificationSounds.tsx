import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { playNotificationSound, unlockNotificationSoundOnFirstGesture } from '@/lib/notificationSound';
import { showDesktopNotification } from '@/lib/desktopNotifications';
import { isChatMuted } from '@/lib/chatPrefs';

let channelCounter = 0;

/**
 * Plays the notification pop (and shows a system notification if switched on in Settings) when a notification or a message from someone else arrives (signed in only).
 * Realtime only delivers rows the user may read: their own notifications, broadcasts, and their conversations.
 */
export default function NotificationSounds() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => unlockNotificationSoundOnFirstGesture(), []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notification-sounds-${++channelCounter}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as { id?: string; user_id?: string | null; actor_id?: string | null; title?: string; body?: string | null };
        if (n.actor_id === userId) return;
        if (n.user_id && n.user_id !== userId) return;
        playNotificationSound();
        showDesktopNotification(n.title || 'Pulse', n.body, n.id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as { id?: string; sender_id?: string; kind?: string; body?: string; conversation_id?: string };
        if (m.sender_id === userId || m.kind === 'system' || isChatMuted(m.conversation_id)) return;
        playNotificationSound();
        showDesktopNotification('New message', m.body, m.conversation_id);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
