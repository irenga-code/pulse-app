import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { CallKind } from '@/lib/types';

/**
 * WebRTC plumbing for 1-on-1 calls. Media goes peer to peer; the offer / answer / ICE candidates travel over private
 * Supabase Realtime broadcast channels, one inbox per user (`call:<user id>`, migration 23): only you can listen to
 * yours, and only people allowed to call you (a shared chat, no block) can post to it.
 */

/** Google's public STUN servers, plus a TURN server when configured (VITE_TURN_URL[S] / _USERNAME / _CREDENTIAL).
 *  STUN is enough on most home and office networks; mobile carriers and strict NATs need TURN to relay the media. */
const turnUrls = ((import.meta.env.VITE_TURN_URLS ?? import.meta.env.VITE_TURN_URL ?? '') as string)
  .split(',').map((u) => u.trim()).filter(Boolean);
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(turnUrls.length ? [{
    urls: turnUrls,
    username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
  }] : []),
];

export const createPeerConnection = () => new RTCPeerConnection({ iceServers: ICE_SERVERS });

export const callsSupported = () =>
  typeof window !== 'undefined' && 'RTCPeerConnection' in window && !!navigator.mediaDevices?.getUserMedia;

export type EndReason = 'hangup' | 'declined' | 'busy' | 'cancelled' | 'missed' | 'failed';

/** What travels over the inbox. `callId` is the calls row id: random, and only the two people can see it. */
export type CallSignal =
  | { type: 'call-invite'; callId: string; from: string; kind: CallKind; sdp: RTCSessionDescriptionInit }
  | { type: 'call-accepted'; callId: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; callId: string; from: string; candidate: RTCIceCandidateInit }
  | { type: 'call-ended'; callId: string; from: string; reason: EndReason };

const EVENTS = ['call-invite', 'call-accepted', 'ice-candidate', 'call-ended'] as const;
const inbox = (userId: string) => `call:${userId}`;

/** Listen for signals sent to you. Returns the unsubscribe. */
export function listenForCallSignals(me: string, onSignal: (s: CallSignal) => void): () => void {
  const channel = supabase.channel(inbox(me), { config: { private: true, broadcast: { self: false } } });
  for (const event of EVENTS) {
    channel.on('broadcast', { event }, ({ payload }) => {
      const p = payload as Partial<CallSignal> | null;
      if (p && typeof p.callId === 'string' && typeof p.from === 'string') onSignal({ ...p, type: event } as CallSignal);
    });
  }
  channel.subscribe();
  return () => { void supabase.removeChannel(channel); };
}

// Sending never joins the other person's inbox (we could not: only they may read it). On a channel that is not
// subscribed, send() posts over Realtime's HTTP broadcast endpoint, which the inbox's send policy checks.
const outboxes = new Map<string, RealtimeChannel>();

export async function sendCallSignal(to: string, signal: CallSignal) {
  let channel = outboxes.get(to);
  if (!channel) {
    channel = supabase.channel(inbox(to), { config: { private: true } });
    outboxes.set(to, channel);
  }
  const { type, ...payload } = signal;
  const res = await channel.send({ type: 'broadcast', event: type, payload });
  if (res !== 'ok') throw new Error('Could not reach the other phone. Check your connection.');
}

/** Drop the send-only channel to someone once a call with them is over. */
export function closeOutbox(to: string) {
  const channel = outboxes.get(to);
  if (!channel) return;
  outboxes.delete(to);
  void supabase.removeChannel(channel);
}

/** Microphone, plus the camera for video calls. Throws a readable message when blocked or missing. */
export async function getCallMedia(kind: CallKind): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: kind === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    const what = kind === 'video' ? 'camera and microphone' : 'microphone';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error(`Allow Pulse to use your ${what} in the browser to make calls.`);
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error(`No ${what} found on this device.`);
    if (name === 'NotReadableError') throw new Error(`Your ${what} is in use by another app.`);
    throw new Error(`Could not start your ${what}.`);
  }
}
