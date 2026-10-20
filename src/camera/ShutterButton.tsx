import { useRef } from 'react';
import { LONG_PRESS_MS } from '@/camera/constants';

type Props = {
  onPhoto: () => void;
  onRecordStart: () => void;
  onRecordStop: () => void;
  recording: boolean;
  /** 0..1 of the max recording time */
  progress: number;
  videoSupported: boolean;
  disabled?: boolean;
};

/** Snapchat-style shutter: tap for a photo, press and hold to record video (ring shows progress). */
export default function ShutterButton({ onPhoto, onRecordStart, onRecordStop, recording, progress, videoSupported, disabled }: Props) {
  const timer = useRef<number | undefined>(undefined);
  const holding = useRef(false);
  const down = useRef(false);
  const R = 44;
  const C = 2 * Math.PI * R;

  const press = (e: React.PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = true;
    holding.current = false;
    if (videoSupported) {
      timer.current = window.setTimeout(() => {
        if (!down.current) return;
        holding.current = true;
        onRecordStart();
      }, LONG_PRESS_MS);
    }
  };
  const release = () => {
    if (!down.current) return;
    down.current = false;
    window.clearTimeout(timer.current);
    if (holding.current) { holding.current = false; onRecordStop(); }
    else if (!disabled) onPhoto();
  };

  return (
    <button
      type="button"
      aria-label={videoSupported ? 'Take photo (hold to record video)' : 'Take photo'}
      data-testid="shutter"
      disabled={disabled}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={() => { down.current = false; window.clearTimeout(timer.current); if (holding.current) { holding.current = false; onRecordStop(); } }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onPhoto(); } }}
      className="relative w-24 h-24 flex items-center justify-center select-none touch-none disabled:opacity-40"
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="6" />
        {recording && (
          <circle cx="50" cy="50" r={R} fill="none" stroke="#ff3b30" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        )}
      </svg>
      <span className={`rounded-full transition-all duration-150 ${recording ? 'w-9 h-9 bg-red-500 rounded-lg' : 'w-16 h-16 bg-white'}`} />
    </button>
  );
}
