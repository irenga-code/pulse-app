import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Maximize2, Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useCall, type ActiveCall } from '@/context/CallContext';
import { contactLabel, useContacts } from '@/lib/contacts';

const pad = (n: number) => String(n).padStart(2, '0');
function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function statusText(c: ActiveCall, now: number) {
  const video = c.kind === 'video';
  switch (c.phase) {
    case 'outgoing': return 'Ringing…';
    case 'incoming': return video ? 'Incoming video call' : 'Incoming voice call';
    case 'connecting': return 'Connecting…';
    case 'active': return c.reconnecting ? 'Reconnecting…' : duration(now - (c.connectedAt ?? now));
    case 'ended':
      switch (c.ended) {
        case 'declined': return c.direction === 'out' ? 'Call declined' : 'Call ended';
        case 'busy': return 'On another call';
        case 'missed': return c.direction === 'out' ? 'No answer' : 'Missed call';
        case 'cancelled': return c.direction === 'in' ? 'Missed call' : 'Call ended';
        case 'failed': return 'Call failed';
        default: return c.connectedAt ? `Call ended · ${duration(now - c.connectedAt)}` : 'Call ended';
      }
  }
}

/** A callback ref that plays `stream` in a <video> / <audio> element whenever the element mounts or the stream changes. */
const play = (stream: MediaStream | null) => (el: HTMLMediaElement | null) => {
  if (!el || el.srcObject === stream) return;
  el.srcObject = stream;
  if (stream) el.play().catch(() => undefined);
};

const roundBtn = 'w-14 h-14 rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

/**
 * The call screen: full-screen dark overlay (caller, remote video, local picture-in-picture, mute / camera / end), or a
 * small floating card when minimised. Mounted once, at the app root (App.tsx).
 */
export default function CallModal() {
  const { call, localStream, remoteStream, accept, decline, hangup, toggleMute, toggleCamera, dismiss } = useCall();
  const contacts = useContacts();
  const [minimised, setMinimised] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const live = call?.phase === 'active';
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  // a new call (or one ringing in) always opens full screen
  useEffect(() => { if (call?.phase === 'incoming' || call?.phase === 'outgoing') setMinimised(false); }, [call?.id, call?.phase]);

  if (!call) return null;

  const name = contactLabel(contacts[call.peerId], call.peer?.display_name).title;
  const video = call.kind === 'video';
  const showRemoteVideo = video && !!remoteStream && remoteStream.getVideoTracks().length > 0 && (call.phase === 'active' || call.phase === 'connecting');
  const showLocalVideo = video && !!localStream && !call.cameraOff && call.phase !== 'ended';
  const status = statusText(call, now);
  const ended = call.phase === 'ended';

  const controls = call.phase === 'incoming' ? (
    <div className="flex items-center justify-center gap-16">
      <div className="flex flex-col items-center gap-2">
        <button type="button" onClick={decline} aria-label="Decline call" className={`${roundBtn} bg-[#f15c6d] hover:bg-[#e04657] text-white`}>
          <PhoneOff className="w-6 h-6" />
        </button>
        <span className="text-xs text-[#aebac1]">Decline</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button type="button" onClick={() => void accept()} aria-label={video ? 'Accept video call' : 'Accept voice call'}
          className={`${roundBtn} bg-[#00a884] hover:bg-[#06cf9c] text-white animate-pulse`}>
          {video ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
        </button>
        <span className="text-xs text-[#aebac1]">Accept</span>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-center gap-5 rounded-full bg-[#111b21]/90 px-6 py-3 w-fit mx-auto shadow-lg">
      {video && (
        <button type="button" onClick={toggleCamera} disabled={ended} aria-pressed={call.cameraOff} aria-label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
          className={`${roundBtn} ${call.cameraOff ? 'bg-white text-[#111b21]' : 'bg-white/10 hover:bg-white/20 text-white'} disabled:opacity-40`}>
          {call.cameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>
      )}
      <button type="button" onClick={toggleMute} disabled={ended} aria-pressed={call.muted} aria-label={call.muted ? 'Unmute microphone' : 'Mute microphone'}
        className={`${roundBtn} ${call.muted ? 'bg-white text-[#111b21]' : 'bg-white/10 hover:bg-white/20 text-white'} disabled:opacity-40`}>
        {call.muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
      </button>
      <button type="button" onClick={ended ? dismiss : hangup} aria-label={ended ? 'Close' : 'End call'}
        className={`${roundBtn} bg-[#f15c6d] hover:bg-[#e04657] text-white`}>
        <PhoneOff className="w-6 h-6" />
      </button>
    </div>
  );

  return createPortal(
    <>
      {/* remote sound always plays here, so minimising (which hides the videos) never cuts the audio */}
      <audio ref={play(remoteStream)} autoPlay className="hidden" />
      {minimised ? (
        <div role="dialog" aria-label={`Call with ${name}`}
          className="fixed bottom-20 md:bottom-6 right-4 z-[70] w-72 rounded-2xl bg-[#111b21] text-white shadow-2xl border border-white/10 p-3 flex items-center gap-3 animate-fade-in">
          <Avatar name={name} url={call.peer?.avatar_url} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold truncate">{name}</span>
            <span className="block text-xs text-[#aebac1] tabular-nums">{status}</span>
          </span>
          <button type="button" onClick={() => setMinimised(false)} aria-label="Open call" className="p-2 rounded-full hover:bg-white/10"><Maximize2 className="w-4 h-4" /></button>
          <button type="button" onClick={hangup} aria-label="End call" className="p-2 rounded-full bg-[#f15c6d] hover:bg-[#e04657]"><PhoneOff className="w-4 h-4" /></button>
        </div>
      ) : (
        <div role="dialog" aria-modal="true" aria-label={`Call with ${name}`}
          className="fixed inset-0 z-[70] bg-[#0b141a] text-white flex flex-col animate-fade-in overflow-hidden">
          {showRemoteVideo && <video ref={play(remoteStream)} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover bg-black" />}
          {/* soft gradients keep the name and controls readable over video */}
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

          <header className="relative flex items-center px-4 pt-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
            {call.phase !== 'incoming' && !ended && (
              <button type="button" onClick={() => setMinimised(true)} aria-label="Minimise call" className="p-2 rounded-full hover:bg-white/10"><ChevronDown className="w-6 h-6" /></button>
            )}
          </header>

          <div className={`relative flex-1 flex flex-col items-center ${showRemoteVideo ? 'justify-start pt-2' : 'justify-center'} gap-4 px-6 text-center`}>
            {!showRemoteVideo && <Avatar name={name} url={call.peer?.avatar_url} size={128} />}
            <div>
              <h2 className="text-2xl font-semibold text-[#f8fafc] drop-shadow">{name}</h2>
              <p className={`mt-1 text-sm tabular-nums drop-shadow ${call.phase === 'ended' && call.ended !== 'hangup' ? 'text-[#f15c6d]' : 'text-[#aebac1]'}`}>{status}</p>
            </div>
          </div>

          {showLocalVideo && (
            <video ref={play(localStream)} autoPlay playsInline muted aria-label="Your camera"
              className="absolute right-4 bottom-32 w-28 md:w-44 aspect-[3/4] md:aspect-video object-cover rounded-xl border border-white/20 shadow-xl bg-black -scale-x-100" />
          )}

          <div className="relative pb-8 px-4" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>{controls}</div>
        </div>
      )}
    </>,
    document.body,
  );
}
