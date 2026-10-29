import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { stableContext } from '@/lib/stableContext';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import type { CallKind, CallStatus, PublicProfile } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { startRingtone } from '@/lib/notificationSound';
import { showDesktopNotification } from '@/lib/desktopNotifications';
import {
  callsSupported, closeOutbox, createPeerConnection, getCallMedia, listenForCallSignals, sendCallSignal,
  type CallSignal, type EndReason,
} from '@/lib/webrtc';

export type CallPhase = 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type ActiveCall = {
  id: string;
  peerId: string;
  peer: PublicProfile | null;
  kind: CallKind;
  direction: 'out' | 'in';
  phase: CallPhase;
  /** When media first flowed; the call timer counts from here. */
  connectedAt: number | null;
  /** Media dropped and WebRTC is trying to recover. */
  reconnecting: boolean;
  ended: EndReason | null;
  muted: boolean;
  cameraOff: boolean;
};

type CallContextValue = {
  call: ActiveCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Ring someone you chat with. `peer` paints the call screen straight away. */
  startCall: (peerId: string, kind: CallKind, peer?: PublicProfile | null) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** Close the "Call ended" screen early. */
  dismiss: () => void;
};

const CallContext = stableContext<CallContextValue | undefined>('call', undefined);

const RING_MS = 45_000;
/** An invite older than this is stale (the caller's own ring timeout has passed). */
const INVITE_MAX_AGE_MS = 50_000;
const ENDED_SCREEN_MS = 2200;

/** The calls row status written by the side that ends the call. */
function statusFor(reason: EndReason, connected: boolean): CallStatus {
  if (reason === 'hangup') return connected ? 'ended' : 'cancelled';
  return reason;
}

/**
 * One call at a time, 1-on-1, over WebRTC. Signalling: src/lib/webrtc.ts. Invites are only trusted once the calls row
 * (caller stamped by the server) confirms who is calling; every other signal must carry the current call's id.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { show } = useToast();
  const me = user?.id ?? null;

  const [call, setCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // signals arrive outside React's render cycle: handlers read the live call from refs
  const callRef = useRef<ActiveCall | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null);
  /** Candidates for the current call that arrived before the remote description was set. */
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  /** Candidates for a call we have not heard the invite for yet (separate HTTP sends can overtake each other). */
  const earlyIce = useRef(new Map<string, { at: number; list: RTCIceCandidateInit[] }>());
  const stopRing = useRef<() => void>(() => undefined);
  const ringTimer = useRef<number | undefined>(undefined);
  const endedTimer = useRef<number | undefined>(undefined);
  const starting = useRef(false);

  const put = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);
  const patch = useCallback((p: Partial<ActiveCall>) => {
    if (callRef.current) put({ ...callRef.current, ...p });
  }, [put]);

  const silence = useCallback(() => {
    stopRing.current();
    stopRing.current = () => undefined;
    window.clearTimeout(ringTimer.current);
  }, []);

  const releaseMedia = useCallback(() => {
    silence();
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    offerRef.current = null;
    pendingIce.current = [];
    setLocalStream(null);
    setRemoteStream(null);
  }, [silence]);

  /** End the current call. `notify` tells the other side and records the outcome on the calls row. */
  const finish = useCallback((reason: EndReason, notify: boolean) => {
    const c = callRef.current;
    if (!me || !c || c.phase === 'ended') return;
    if (notify) {
      sendCallSignal(c.peerId, { type: 'call-ended', callId: c.id, from: me, reason })
        .catch(() => undefined)
        .finally(() => closeOutbox(c.peerId));
      api.setCallStatus(c.id, statusFor(reason, c.connectedAt !== null)).catch(() => undefined);
    } else {
      closeOutbox(c.peerId);
    }
    releaseMedia();
    put({ ...c, phase: 'ended', ended: reason, reconnecting: false });
    window.clearTimeout(endedTimer.current);
    endedTimer.current = window.setTimeout(() => { if (callRef.current?.id === c.id) put(null); }, ENDED_SCREEN_MS);
  }, [me, put, releaseMedia]);

  const addIce = useCallback((candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current;
    if (pc?.remoteDescription) pc.addIceCandidate(candidate).catch(() => undefined);
    else pendingIce.current.push(candidate);
  }, []);
  const flushIce = useCallback(() => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const c of pendingIce.current.splice(0)) pc.addIceCandidate(c).catch(() => undefined);
  }, []);

  const openPeer = useCallback((callId: string, peerId: string, stream: MediaStream) => {
    const pc = createPeerConnection();
    pcRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate && me) sendCallSignal(peerId, { type: 'ice-candidate', callId, from: me, candidate: e.candidate.toJSON() }).catch(() => undefined);
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (callRef.current?.id !== callId || pcRef.current !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected') patch({ phase: 'active', reconnecting: false, connectedAt: callRef.current.connectedAt ?? Date.now() });
      else if (state === 'disconnected') patch({ reconnecting: true });
      else if (state === 'failed') finish('failed', true);
    };
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    return pc;
  }, [me, patch, finish]);

  const startCall = useCallback(async (peerId: string, kind: CallKind, peer: PublicProfile | null = null) => {
    if (!me) return;
    if (callRef.current || starting.current) { show('You are already on a call.', 'error'); return; }
    if (!callsSupported()) { show('This browser can not make calls.', 'error'); return; }
    starting.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await getCallMedia(kind);
      const id = await api.createCall(peerId, kind);
      window.clearTimeout(endedTimer.current);
      localRef.current = stream;
      setLocalStream(stream);
      put({ id, peerId, peer, kind, direction: 'out', phase: 'outgoing', connectedAt: null, reconnecting: false, ended: null, muted: false, cameraOff: false });
      starting.current = false;
      const pc = openPeer(id, peerId, stream);
      await pc.setLocalDescription(await pc.createOffer());
      if (callRef.current?.id !== id) return; // hung up while setting up
      await sendCallSignal(peerId, { type: 'call-invite', callId: id, from: me, kind, sdp: pc.localDescription!.toJSON() });
      if (callRef.current?.id !== id || callRef.current.phase !== 'outgoing') return;
      stopRing.current = startRingtone('outgoing');
      ringTimer.current = window.setTimeout(() => { if (callRef.current?.id === id && callRef.current.phase === 'outgoing') finish('missed', true); }, RING_MS);
    } catch (e) {
      starting.current = false;
      show(friendlyError(e), 'error');
      if (callRef.current) finish('failed', true);
      else stream?.getTracks().forEach((t) => t.stop());
    }
  }, [me, show, put, openPeer, finish]);

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (!me || !c || c.phase !== 'incoming' || !offerRef.current) return;
    silence();
    patch({ phase: 'connecting' });
    try {
      const stream = await getCallMedia(c.kind);
      if (callRef.current?.id !== c.id || callRef.current.phase === 'ended') { stream.getTracks().forEach((t) => t.stop()); return; }
      localRef.current = stream;
      setLocalStream(stream);
      const pc = openPeer(c.id, c.peerId, stream);
      await pc.setRemoteDescription(offerRef.current);
      flushIce();
      await pc.setLocalDescription(await pc.createAnswer());
      await sendCallSignal(c.peerId, { type: 'call-accepted', callId: c.id, from: me, sdp: pc.localDescription!.toJSON() });
      api.setCallStatus(c.id, 'accepted').catch(() => undefined);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not answer the call.', 'error');
      finish('failed', true);
    }
  }, [me, silence, patch, openPeer, flushIce, show, finish]);

  const decline = useCallback(() => finish('declined', true), [finish]);
  const hangup = useCallback(() => finish(callRef.current?.phase === 'outgoing' ? 'cancelled' : 'hangup', true), [finish]);
  const dismiss = useCallback(() => { if (callRef.current?.phase === 'ended') put(null); }, [put]);

  const toggleMute = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    localRef.current?.getAudioTracks().forEach((t) => { t.enabled = c.muted; });
    patch({ muted: !c.muted });
  }, [patch]);
  const toggleCamera = useCallback(() => {
    const c = callRef.current;
    if (!c || c.kind !== 'video') return;
    localRef.current?.getVideoTracks().forEach((t) => { t.enabled = c.cameraOff; });
    patch({ cameraOff: !c.cameraOff });
  }, [patch]);

  // the signal handler changes with its dependencies; the inbox subscription stays put and calls the latest one
  const onSignalRef = useRef<(s: CallSignal) => void>(() => undefined);
  onSignalRef.current = (s: CallSignal) => {
    if (!me || s.from === me) return;
    const c = callRef.current;
    const current = !!c && c.id === s.callId && c.peerId === s.from && c.phase !== 'ended';

    switch (s.type) {
      case 'call-invite': {
        void (async () => {
          // trust nothing in the invite but the call id: the row says who is calling
          const row = await api.getCall(s.callId).catch(() => null);
          if (!row || row.caller_id !== s.from || row.callee_id !== me || row.status !== 'ringing') return;
          if (Date.now() - Date.parse(row.created_at) > INVITE_MAX_AGE_MS) return;
          if (callRef.current?.phase === 'ended') put(null);
          if (callRef.current || starting.current) {
            sendCallSignal(s.from, { type: 'call-ended', callId: s.callId, from: me, reason: 'busy' }).catch(() => undefined).finally(() => closeOutbox(s.from));
            api.setCallStatus(s.callId, 'busy').catch(() => undefined);
            return;
          }
          window.clearTimeout(endedTimer.current);
          offerRef.current = s.sdp;
          pendingIce.current = earlyIce.current.get(s.callId)?.list ?? [];
          earlyIce.current.delete(s.callId);
          put({ id: row.id, peerId: s.from, peer: null, kind: row.kind, direction: 'in', phase: 'incoming', connectedAt: null, reconnecting: false, ended: null, muted: false, cameraOff: false });
          stopRing.current = startRingtone('incoming');
          ringTimer.current = window.setTimeout(() => { if (callRef.current?.id === row.id && callRef.current.phase === 'incoming') finish('missed', false); }, RING_MS);
          const people = await api.profilesByIds([s.from]).catch(() => ({} as Record<string, PublicProfile>));
          const peer = people[s.from] ?? null;
          if (callRef.current?.id === row.id) patch({ peer });
          showDesktopNotification(`${peer?.display_name ?? 'Someone'} is calling`, row.kind === 'video' ? 'Incoming video call' : 'Incoming voice call', `call-${row.id}`);
        })();
        return;
      }
      case 'ice-candidate': {
        if (current) { addIce(s.candidate); return; }
        if (c && c.id === s.callId) return;
        // not ours yet: keep a few, briefly, in case the invite is still on its way
        const now = Date.now();
        for (const [id, v] of earlyIce.current) if (now - v.at > INVITE_MAX_AGE_MS) earlyIce.current.delete(id);
        const entry = earlyIce.current.get(s.callId) ?? { at: now, list: [] };
        if (earlyIce.current.size < 8 && entry.list.length < 64) {
          entry.list.push(s.candidate);
          earlyIce.current.set(s.callId, entry);
        }
        return;
      }
      case 'call-accepted': {
        if (!current || c!.direction !== 'out' || c!.phase !== 'outgoing') return;
        silence();
        patch({ phase: 'connecting' });
        pcRef.current?.setRemoteDescription(s.sdp).then(flushIce).catch(() => finish('failed', true));
        return;
      }
      case 'call-ended': {
        earlyIce.current.delete(s.callId);
        if (current) finish(s.reason, false);
      }
    }
  };

  useEffect(() => {
    if (!me || !callsSupported()) return;
    return listenForCallSignals(me, (s) => onSignalRef.current(s));
  }, [me]);

  // signed out: drop the call and free the camera / microphone
  useEffect(() => {
    if (!me && callRef.current) { releaseMedia(); put(null); }
  }, [me, releaseMedia, put]);
  // the tab is closing: hang up so the other side is not left ringing
  useEffect(() => {
    const onHide = () => {
      const c = callRef.current;
      if (c && c.phase !== 'ended') finish(c.phase === 'incoming' ? 'declined' : c.phase === 'outgoing' ? 'cancelled' : 'hangup', true);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [finish]);
  useEffect(() => () => { window.clearTimeout(endedTimer.current); releaseMedia(); }, [releaseMedia]);

  const value = useMemo(
    () => ({ call, localStream, remoteStream, startCall, accept, decline, hangup, toggleMute, toggleCamera, dismiss }),
    [call, localStream, remoteStream, startCall, accept, decline, hangup, toggleMute, toggleCamera, dismiss]
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
