import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smile, Search, Clock, PersonStanding, PawPrint, Utensils, Plane, Trophy, Lightbulb, Shapes, Flag, Loader2, X, type LucideIcon } from 'lucide-react';
import { EmojiImg } from '@/components/emoji/EmojiImg';
import {
  loadEmojiLibrary, searchEmoji, withTone, loadRecent, pushRecent, loadTone, saveTone,
  type EmojiGroup, type EmojiGroupId, type EmojiEntry,
} from '@/components/emoji/emojiLibrary';

const TAB_ICONS: Record<EmojiGroupId | 'recent', LucideIcon> = {
  recent: Clock, smileys: Smile, people: PersonStanding, animals: PawPrint, food: Utensils,
  travel: Plane, activities: Trophy, objects: Lightbulb, symbols: Shapes, flags: Flag,
};
const TONE_SWATCH = ['#ffcc33', '#f7d7b5', '#e0b48a', '#c18e63', '#8d5a3b', '#5a3a29'];
const TONE_LABEL = ['Default skin tone', 'Light skin tone', 'Medium-light skin tone', 'Medium skin tone', 'Medium-dark skin tone', 'Dark skin tone'];

/**
 * WhatsApp-style emoji panel: search, category tabs, one scrolling list with a heading per category,
 * recents and a skin-tone chooser. Emoji are drawn with Twemoji so they look the same on every device.
 * Calls onPick(emoji) with the real emoji character.
 */
export function EmojiPanel({ onPick, variant = 'popover' }: { onPick: (emoji: string) => void; variant?: 'popover' | 'sheet' }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [tone, setTone] = useState(loadTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [active, setActive] = useState<EmojiGroupId | 'recent'>(recent.length ? 'recent' : 'smileys');
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    let alive = true;
    loadEmojiLibrary().then((g) => alive && setGroups(g)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => (groups && query.trim() ? searchEmoji(groups, query) : null), [groups, query]);

  const pick = useCallback((emoji: string) => {
    setRecent(pushRecent(emoji));
    onPick(emoji);
  }, [onPick]);

  const jump = (id: EmojiGroupId | 'recent') => {
    setActive(id);
    const el = sections.current[id];
    const box = scroller.current;
    if (el && box) box.scrollTo({ top: el.offsetTop - box.offsetTop, behavior: 'smooth' });
  };

  // highlight the tab of the section currently at the top
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    let current: EmojiGroupId | 'recent' = active;
    for (const [id, el] of Object.entries(sections.current)) {
      if (el && el.offsetTop - box.offsetTop <= box.scrollTop + 8) current = id as EmojiGroupId | 'recent';
    }
    if (current !== active) setActive(current);
  };

  const cell = (entry: EmojiEntry) => {
    const e = withTone(entry, tone);
    return (
      <button
        type="button"
        key={entry.e}
        role="option"
        aria-selected={false}
        aria-label={entry.l}
        title={entry.l}
        // keep focus (and caret) in the text field the emoji is going into
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => pick(e)}
        className="h-10 w-full flex items-center justify-center text-[26px] leading-none rounded-lg hover:bg-wa-green/15 active:scale-90 transition-transform"
      >
        <EmojiImg emoji={e} />
      </button>
    );
  };

  const recentEntries: EmojiEntry[] = recent.map((e) => ({ e, l: e, t: [] }));
  const tabs: (EmojiGroupId | 'recent')[] = [...(recent.length ? (['recent'] as const) : []), ...(groups?.map((g) => g.id) ?? [])];
  const frame = variant === 'sheet' ? 'w-full h-[46vh] rounded-t-3xl' : 'w-[22rem] max-w-[92vw] h-[22rem] rounded-2xl';
  const label = (id: string) => (id === 'recent' ? 'Recent' : groups?.find((g) => g.id === id)?.label ?? id);

  return (
    <div className={`flex flex-col ${frame} bg-wa-lightPanel dark:bg-wa-darkPanel border border-wa-lightBorder dark:border-wa-darkBorder shadow-2xl overflow-hidden`} data-testid="emoji-panel">
      <div className="flex items-center gap-2 p-2 pb-1">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="w-full rounded-lg pl-8 pr-7 py-1.5 text-xs bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText border border-wa-lightBorder dark:border-wa-darkBorder focus:outline-none focus:border-wa-green"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Skin tone"
            aria-expanded={toneOpen}
            onClick={() => setToneOpen((o) => !o)}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-wa-lightBorder dark:border-wa-darkBorder"
          >
            <span className="w-4 h-4 rounded-full border border-black/10" style={{ background: TONE_SWATCH[tone] }} />
          </button>
          {toneOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 flex gap-1.5 p-2 rounded-xl bg-wa-lightPanel dark:bg-wa-darkSecondary border border-wa-lightBorder dark:border-wa-darkBorder shadow-xl" role="listbox" aria-label="Choose skin tone">
              {TONE_SWATCH.map((c, i) => (
                <button
                  type="button"
                  key={c}
                  role="option"
                  aria-selected={tone === i}
                  aria-label={TONE_LABEL[i]}
                  onClick={() => { setTone(i); saveTone(i); setToneOpen(false); }}
                  className={`w-6 h-6 rounded-full border-2 ${tone === i ? 'border-wa-green' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {!results && (
        <div className="flex px-1 border-b border-wa-lightBorder dark:border-wa-darkBorder" role="tablist" aria-label="Emoji categories">
          {tabs.map((id) => {
            const Icon = TAB_ICONS[id];
            return (
              <button
                type="button"
                key={id}
                role="tab"
                aria-selected={active === id}
                aria-label={label(id)}
                title={label(id)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => jump(id)}
                className={`flex-1 flex items-center justify-center py-2 border-b-2 transition-colors ${
                  active === id ? 'border-wa-green text-wa-green' : 'border-transparent text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            );
          })}
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-label="Emoji">
        {failed ? (
          <p className="text-center text-xs py-8 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">Could not load emoji. Check your connection.</p>
        ) : !groups ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-wa-green animate-spin" /></div>
        ) : results ? (
          results.length === 0 ? (
            <p className="text-center text-xs py-8 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">No matches</p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5 pt-2">{results.map(cell)}</div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section ref={(el) => { sections.current.recent = el; }} aria-label="Recent">
                <h3 className="sticky top-0 z-[1] py-1.5 text-[11px] font-semibold uppercase tracking-wide bg-wa-lightPanel dark:bg-wa-darkPanel text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">Recent</h3>
                <div className="grid grid-cols-8 gap-0.5">{recentEntries.map(cell)}</div>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.id} ref={(el) => { sections.current[g.id] = el; }} aria-label={g.label} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' }}>
                <h3 className="sticky top-0 z-[1] py-1.5 text-[11px] font-semibold uppercase tracking-wide bg-wa-lightPanel dark:bg-wa-darkPanel text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">{g.label}</h3>
                <div className="grid grid-cols-8 gap-0.5">{g.items.map(cell)}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;

/**
 * Smiley button. Opens the panel as a bottom sheet on phones and as a popover next to the button on bigger screens.
 * The panel stays open while you pick several emoji; tap outside or press Esc to close.
 */
export default function EmojiButton({ onPick, className = '', label = 'Add emoji', up = true }: {
  onPick: (emoji: string) => void; className?: string; label?: string; up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    setDesktop(isDesktop());
    setOpen((o) => !o);
  };

  useLayoutEffect(() => {
    if (!open || !desktop || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth * 0.92);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const roomAbove = r.top;
    if (up && roomAbove > 360) setPos({ left, bottom: window.innerHeight - r.top + 8 });
    else setPos({ left, top: Math.min(r.bottom + 8, window.innerHeight - 360) });
  }, [open, desktop, up]);

  // On phones the sheet covers the bottom of the screen: tell full-screen layouts (chat) to make room for it.
  useEffect(() => {
    if (!open || desktop) return;
    const root = document.documentElement;
    root.style.setProperty('--emoji-sheet', '46vh');
    return () => { root.style.removeProperty('--emoji-sheet'); };
  }, [open, desktop]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Escape closes only the picker, not the modal / chat it sits in: handle it first (capture) and stop it there
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="p-2 rounded-xl text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green transition-colors"
      >
        <Smile className="w-5 h-5" />
      </button>
      {open &&
        createPortal(
          desktop ? (
            <div ref={popRef} className="fixed z-[70]" style={pos} role="dialog" aria-label="Emoji picker">
              <EmojiPanel onPick={onPick} variant="popover" />
            </div>
          ) : (
            <div className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none" role="presentation">
              <div ref={popRef} className="w-full animate-slide-up pointer-events-auto" role="dialog" aria-label="Emoji picker" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <EmojiPanel onPick={onPick} variant="sheet" />
              </div>
            </div>
          ),
          document.body
        )}
    </div>
  );
}
