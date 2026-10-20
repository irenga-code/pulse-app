import { useEffect, useRef, useState } from 'react';
import { Undo2, Trash2, Check, X } from 'lucide-react';
import { BRUSH_SIZES, COLORS, EFFECTS, FILTERS, STICKERS, TEXT_STYLES, type EffectId, type FilterId, type StickerDef, type TextStyle } from '@/camera/constants';
import type { TextItem } from '@/camera/types';

const sheet = 'absolute left-0 right-0 bottom-0 z-30 rounded-t-3xl bg-black/80 backdrop-blur-md text-white p-4 animate-slide-up';

export function FilterStrip({ value, onChange, onClose }: { value: FilterId; onChange: (f: FilterId) => void; onClose: () => void }) {
  return (
    <div className={sheet} role="group" aria-label="Filters">
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => onChange(f.id)} aria-pressed={value === f.id} className="flex flex-col items-center gap-1 flex-shrink-0">
            <span className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold border-2 ${value === f.id ? 'border-wa-green bg-wa-green/30' : 'border-white/40 bg-white/10'}`}>
              {f.label[0]}
            </span>
            <span className="text-[11px]">{f.label}</span>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-2 w-full text-xs font-semibold text-white/70">Done</button>
    </div>
  );
}

export function EffectStrip({ value, onChange, onClose }: { value: EffectId; onChange: (f: EffectId) => void; onClose: () => void }) {
  return (
    <div className={sheet} role="group" aria-label="Effects">
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {EFFECTS.map((f) => (
          <button key={f.id} onClick={() => onChange(f.id)} aria-pressed={value === f.id} className="flex flex-col items-center gap-1 flex-shrink-0">
            <span className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 ${value === f.id ? 'border-wa-green bg-wa-green/30' : 'border-white/40 bg-white/10'}`}>{f.icon}</span>
            <span className="text-[11px]">{f.label}</span>
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-2 w-full text-xs font-semibold text-white/70">Done</button>
    </div>
  );
}

export function StickerTray({ onPick, onClose }: { onPick: (s: StickerDef) => void; onClose: () => void }) {
  return (
    <div className={`${sheet} max-h-[55%] overflow-y-auto`} role="group" aria-label="Stickers">
      <div className="flex items-center mb-2">
        <p className="text-sm font-semibold flex-1">Stickers</p>
        <button onClick={onClose} aria-label="Close stickers" className="p-1"><X className="w-5 h-5" /></button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {STICKERS.filter((s) => s.badge).map((s) => (
          <button key={s.id} onClick={() => onPick(s)} aria-label={s.label} className="col-span-5 sm:col-span-5 rounded-lg border border-pink-400/60 bg-black/40 py-1.5 text-xs font-extrabold tracking-wider text-white shadow-[0_0_12px_rgba(255,43,214,0.45)]">
            {s.value}
          </button>
        ))}
        {STICKERS.filter((s) => !s.badge).map((s) => (
          <button key={s.id} onClick={() => onPick(s)} aria-label={`Sticker ${s.label}`} className="h-12 text-3xl rounded-xl hover:bg-white/10 active:scale-90 transition-transform">{s.value}</button>
        ))}
      </div>
    </div>
  );
}

/** Full-screen text entry (also used to edit an existing text by double-tapping it). */
export function TextEditor({ initial, onDone, onCancel }: {
  initial?: TextItem; onDone: (v: { text: string; style: TextStyle; color: string }) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [style, setStyle] = useState<TextStyle>(initial?.style ?? 'classic');
  const [color, setColor] = useState(initial?.color ?? '#ffffff');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex flex-col text-white" role="dialog" aria-label="Add text">
      <div className="flex items-center px-4 py-3">
        <button onClick={onCancel} aria-label="Cancel text" className="p-1"><X className="w-6 h-6" /></button>
        <div className="flex-1 flex justify-center gap-1.5">
          {TEXT_STYLES.map((s) => (
            <button key={s.id} onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className={`rounded-full px-3 py-1 text-xs font-semibold ${style === s.id ? 'bg-white text-black' : 'bg-white/15'}`}>{s.label}</button>
          ))}
        </div>
        <button onClick={() => text.trim() && onDone({ text: text.trim(), style, color })} disabled={!text.trim()} aria-label="Done" className="p-1 disabled:opacity-40"><Check className="w-6 h-6 text-wa-green" /></button>
      </div>
      <div className="flex-1 flex items-center justify-center px-6">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 80))}
          rows={3}
          placeholder="Type something…"
          aria-label="Overlay text"
          style={{ color }}
          className="w-full bg-transparent text-center text-4xl font-extrabold resize-none focus:outline-none placeholder:text-white/40"
        />
      </div>
      <div className="flex gap-2 justify-center px-4 pb-6 flex-wrap" role="group" aria-label="Text colour">
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`} aria-pressed={color === c} style={{ background: c }} className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-white/30'}`} />
        ))}
      </div>
    </div>
  );
}

export function DrawBar({ color, width, onColor, onWidth, onUndo, onClear, onDone, canUndo }: {
  color: string; width: number; onColor: (c: string) => void; onWidth: (w: number) => void;
  onUndo: () => void; onClear: () => void; onDone: () => void; canUndo: boolean;
}) {
  return (
    <div className="absolute left-0 right-0 bottom-0 z-30 bg-black/70 backdrop-blur-md text-white px-3 py-3 flex flex-col gap-2" role="group" aria-label="Drawing tools">
      <div className="flex gap-2 justify-center flex-wrap">
        {COLORS.map((c) => (
          <button key={c} onClick={() => onColor(c)} aria-label={`Brush colour ${c}`} aria-pressed={color === c} style={{ background: c }} className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-white/30'}`} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3 items-center">
          {BRUSH_SIZES.map((s) => (
            <button key={s} onClick={() => onWidth(s)} aria-label={`Brush size ${s}`} aria-pressed={width === s} className={`rounded-full flex items-center justify-center w-9 h-9 ${width === s ? 'bg-white/25' : ''}`}>
              <span style={{ width: Math.max(6, s / 1.6), height: Math.max(6, s / 1.6), background: color }} className="rounded-full block" />
            </button>
          ))}
        </div>
        <div className="flex gap-1 items-center">
          <button onClick={onUndo} disabled={!canUndo} aria-label="Undo stroke" className="p-2 disabled:opacity-30"><Undo2 className="w-5 h-5" /></button>
          <button onClick={onClear} disabled={!canUndo} aria-label="Clear drawing" className="p-2 disabled:opacity-30"><Trash2 className="w-5 h-5" /></button>
          <button onClick={onDone} className="ml-1 rounded-full bg-wa-green px-4 py-1.5 text-sm font-semibold">Done</button>
        </div>
      </div>
    </div>
  );
}
