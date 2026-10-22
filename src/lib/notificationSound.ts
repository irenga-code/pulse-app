/**
 * In-app notification sound: a short, soft two-note pop synthesized with the Web Audio API (no audio file to load).
 * The on/off preference is per device (localStorage), separate from the account-synced alert settings.
 */

const STORAGE_KEY = 'pulse-notification-sounds';
/** Bursts (several rows arriving together) play once. */
const MIN_GAP_MS = 1500;

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;
let lastPlayed = 0;
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
let enabled = readEnabled();

export function notificationSoundsEnabled() {
  return enabled;
}

export function setNotificationSoundsEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: keep it for this session */
  }
  listeners.forEach((l) => l());
}

export function subscribeNotificationSounds(listener: () => void) {
  listeners.add(listener);
  // another tab changed it
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    enabled = readEnabled();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers only allow sound after the person has interacted with the page. Call once at start-up: the first tap or
 * key press wakes the audio context, so later notifications can play.
 */
export function unlockNotificationSoundOnFirstGesture() {
  const unlock = () => {
    const a = audio();
    if (a && a.state === 'suspended') a.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return unlock;
}

function note(a: AudioContext, freq: number, start: number, length: number, peak: number) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  // fast attack, quick exponential fade: a "pop" rather than a beep
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** Play the pop if sounds are on. `force` plays it even when off (the Settings preview). Never throws. */
export function playNotificationSound({ force = false }: { force?: boolean } = {}) {
  if (!enabled && !force) return;
  const now = Date.now();
  if (!force && now - lastPlayed < MIN_GAP_MS) return;
  const a = audio();
  if (!a) return;
  lastPlayed = now;
  try {
    if (a.state === 'suspended') a.resume().catch(() => undefined);
    const t = a.currentTime + 0.01;
    note(a, 880, t, 0.12, 0.12);
    note(a, 1318.5, t + 0.07, 0.18, 0.09);
  } catch {
    /* audio blocked or unavailable */
  }
}
