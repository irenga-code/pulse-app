import { MapPin, X, Check } from 'lucide-react';
import type { Venue } from '@/lib/types';

/** Choose the venue to tag (and optionally stamp on the snap). Venues near you come first. */
export default function VenuePicker({ venues, suggested, selectedId, stampOn, canStamp, geoStatus, onSelect, onStampToggle, onAskLocation, onClose }: {
  venues: Venue[];
  suggested: Venue[];
  selectedId: string | null;
  stampOn: boolean;
  canStamp: boolean;
  geoStatus: 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable';
  onSelect: (v: Venue | null) => void;
  onStampToggle: (on: boolean) => void;
  onAskLocation: () => void;
  onClose: () => void;
}) {
  const row = (v: Venue) => (
    <button key={v.id} onClick={() => { onSelect(v); }} aria-pressed={selectedId === v.id} className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${selectedId === v.id ? 'bg-wa-green/25' : 'hover:bg-white/10'}`}>
      <MapPin className="w-4 h-4 flex-shrink-0 text-wa-green" />
      <span className="flex-1 min-w-0"><span className="font-semibold text-sm">{v.name}</span> <span className="text-xs text-white/60">{v.location}</span></span>
      {selectedId === v.id && <Check className="w-4 h-4 text-wa-green" />}
    </button>
  );
  const others = venues.filter((v) => !suggested.some((s) => s.id === v.id));

  return (
    <div className="absolute left-0 right-0 bottom-0 z-30 max-h-[70%] overflow-y-auto rounded-t-3xl bg-black/85 backdrop-blur-md text-white p-4 animate-slide-up" role="dialog" aria-label="Choose venue">
      <div className="flex items-center mb-2">
        <p className="text-sm font-semibold flex-1">Where are you?</p>
        <button onClick={onClose} aria-label="Close venue picker" className="p-1"><X className="w-5 h-5" /></button>
      </div>

      {suggested.length > 0 ? (
        <>
          <p className="text-[11px] uppercase tracking-wide text-wa-green mb-1">Near you</p>
          {suggested.map(row)}
        </>
      ) : geoStatus === 'denied' ? (
        <p className="text-xs text-white/60 mb-2">Location is blocked. Pick your venue below.</p>
      ) : geoStatus === 'asking' ? (
        <p className="text-xs text-white/60 mb-2">Finding you…</p>
      ) : (
        <button onClick={onAskLocation} className="mb-2 text-xs font-semibold text-wa-green">📍 Suggest venues near me</button>
      )}

      <p className="text-[11px] uppercase tracking-wide text-white/50 mt-2 mb-1">All venues</p>
      {others.map(row)}

      <label className={`mt-3 flex items-center gap-2 text-sm ${canStamp ? '' : 'opacity-50'}`}>
        <input type="checkbox" checked={stampOn} disabled={!canStamp} onChange={(e) => onStampToggle(e.target.checked)} className="accent-[#00a884] w-4 h-4" />
        Stamp the venue name on my snap
      </label>
      {!canStamp && <p className="text-[11px] text-white/50 mt-1">Stamps can’t be added after recording a video.</p>}
      {selectedId && <button onClick={() => onSelect(null)} className="mt-3 text-xs font-semibold text-white/70">Remove venue</button>}
    </div>
  );
}
