import { useSyncExternalStore } from 'react';
import { notificationSoundsEnabled, setNotificationSoundsEnabled, subscribeNotificationSounds } from '@/lib/notificationSound';

/** The device's "In-app notification sounds" preference, kept in sync across components and tabs. */
export function useNotificationSounds() {
  const enabled = useSyncExternalStore(subscribeNotificationSounds, notificationSoundsEnabled, () => true);
  return [enabled, setNotificationSoundsEnabled] as const;
}
