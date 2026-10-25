/**
 * Browser (system) notifications for new messages and notifications while Pulse is in the background.
 * Both switches are saved on this device. Pulse has no push server, so these only arrive while a Pulse tab is open.
 */
const ENABLED_KEY = 'pulse:desktop-notifications';
const PREVIEW_KEY = 'pulse:notification-previews';

type Prefs = { enabled: boolean; previews: boolean };
const listeners = new Set<() => void>();

const read = (key: string, fallback: boolean) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
};
let prefs: Prefs = { enabled: read(ENABLED_KEY, false), previews: read(PREVIEW_KEY, true) };

export const desktopNotificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  (desktopNotificationsSupported() ? Notification.permission : 'unsupported');

export const getDesktopPrefs = () => prefs;
export function subscribeDesktopPrefs(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function save(next: Prefs) {
  prefs = next;
  try {
    localStorage.setItem(ENABLED_KEY, next.enabled ? '1' : '0');
    localStorage.setItem(PREVIEW_KEY, next.previews ? '1' : '0');
  } catch { /* per-device only */ }
  listeners.forEach((fn) => fn());
}

/** Turning it on asks the browser for permission; resolves false if the user (or browser) says no. */
export async function setDesktopNotifications(on: boolean): Promise<boolean> {
  if (!on) { save({ ...prefs, enabled: false }); return true; }
  if (!desktopNotificationsSupported()) return false;
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  const ok = permission === 'granted';
  save({ ...prefs, enabled: ok });
  return ok;
}
export const setNotificationPreviews = (on: boolean) => save({ ...prefs, previews: on });

/** Shows a system notification if switched on, allowed, and Pulse is not the tab in front. */
export function showDesktopNotification(title: string, body: string | null | undefined, tag?: string) {
  if (!prefs.enabled || notificationPermission() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body: prefs.previews ? (body ?? '') : 'Open Pulse to read it.', tag });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}
