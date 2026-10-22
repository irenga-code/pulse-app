import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { playNotificationSound, unlockNotificationSoundOnFirstGesture } from '@/lib/notificationSound';

let channelCounter = 0;

/**
 * Plays the notification pop when a notification or a message from someone else arrives (signed in only).
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
        const n = payload.new as { user_id?: string | null; actor_id?: string | null };
        if (n.actor_id === userId) return;
        if (n.user_id && n.user_id !== userId) return;
        playNotificationSound();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as { sender_id?: string; kind?: string };
        if (m.sender_id === userId || m.kind === 'system') return;
        playNotificationSound();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
