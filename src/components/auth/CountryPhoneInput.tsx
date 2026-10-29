import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { COUNTRIES, SUGGESTED_ISOS, countryByIso, countryForNumber, detectCountryIso, flagOf, DEFAULT_ISO, type Country } from '@/lib/countries';
import { mutedText, bodyText } from '@/components/ui';

const REMEMBER_KEY = 'pulse:phone-country';

/** The selected country: last one used on this device, else a guess from the time zone / language, else Uganda. */
export function usePhoneCountry() {
  const [iso, setIsoState] = useState(() => {
    try { const saved = localStorage.getItem(REMEMBER_KEY); if (countryByIso(saved)) return saved!; } catch { /* no storage */ }
    return detectCountryIso();
  });
  const setIso = (next: string) => {
    setIsoState(next);
    try { localStorage.setItem(REMEMBER_KEY, next); } catch { /* per-device convenience only */ }
  };
  return { country: countryByIso(iso) ?? countryByIso(DEFAULT_ISO)!, setIso };
}

/**
 * A country flag as an image: Windows does not draw flag emoji (it shows "UG"), so the emoji is only the fallback
 * if the image cannot load.
 */
export function Flag({ iso, className = '' }: { iso: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`text-lg leading-none ${className}`} aria-hidden="true">{flagOf(iso)}</span>;
  return (
    <img src={`https://flagcdn.com/${iso.toLowerCase()}.svg`} alt="" aria-hidden="true" width={20} height={15} loading="lazy" decoding="async"
      onError={() => setFailed(true)} className={`w-5 h-[15px] flex-shrink-0 rounded-[3px] object-cover ring-1 ring-black/10 dark:ring-white/10 ${className}`} />
  );
}

const shell = 'relative flex items-stretch rounded-xl border bg-wa-light dark:bg-wa-darkPanel border-wa-lightBorder dark:border-wa-darkBorder '
  + 'focus-within:border-wa-green focus-within:ring-2 focus-within:ring-wa-green/30 transition-colors';

/** `[ 🇺🇬 +256 ▾ ] [ phone number ]` with a searchable country list. Pasting "+44..." switches the country. */
export default function CountryPhoneInput({ country, onCountry, value, onChange, label = 'Phone number', hint, autoFocus }: {
  country: Country; onCountry: (iso: string) => void; value: string; onChange: (v: string) => void;
  label?: string; hint?: string; autoFocus?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const phone = useRef<HTMLInputElement>(null);
  const listId = `${id}-countries`;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) {
      const suggested = SUGGESTED_ISOS.map((i) => countryByIso(i)!).filter(Boolean);
      return [...suggested, ...COUNTRIES.filter((c) => !SUGGESTED_ISOS.includes(c.iso))];
    }
    const digits = /^\d+$/.test(q);
    return COUNTRIES
      .filter((c) => (digits ? c.dial.startsWith(q) : c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q))
      .sort((a, b) => (digits ? a.dial.length - b.dial.length : Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q))));
  }, [query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const pick = (c: Country) => {
    onCountry(c.iso);
    setOpen(false);
    setQuery('');
    phone.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  const onPhone = (v: string) => {
    // a full international number ("+44 7700 900123", or pasted as "0044 ...") picks its country and keeps the local part
    const m = /^\s*(?:\+|00)(\d[\d\s\-().]*)$/.exec(v);
    if (m) {
      const digits = m[1].replace(/\D/g, '');
      const c = digits.length > 4 ? countryForNumber(digits) : undefined;
      if (c) { onCountry(c.iso); onChange(digits.slice(c.dial.length).replace(/^0+/, '')); return; }
      if (v.trimStart().startsWith('+')) { onChange(v.replace(/[^\d\s\-().+]/g, '')); return; }
    }
    // the country code replaces the local trunk 0: "0789 175 095" shows as "789 175 095" next to +256
    onChange(v.replace(/[^\d\s\-().]/g, '').replace(/^[\s\-().]*0+/, ''));
  };

  return (
    <div ref={box} className="relative">
      <label htmlFor={`${id}-phone`} className={`block text-xs font-semibold mb-1.5 ${bodyText}`}>{label}</label>
      <div className={shell}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
          aria-label={`Country code: ${country.name} +${country.dial}`}
          className="flex items-center gap-1.5 pl-3 pr-2 rounded-l-xl border-r border-wa-lightBorder dark:border-wa-darkBorder hover:bg-black/5 dark:hover:bg-white/5 text-sm font-semibold text-wa-lightText dark:text-slate-100 focus:outline-none">
          <Flag iso={country.iso} />
          <span className="tabular-nums">+{country.dial}</span>
          <ChevronDown className={`w-4 h-4 ${mutedText} transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <input id={`${id}-phone`} ref={phone} type="tel" inputMode="tel" autoComplete="tel-national" value={value} onChange={(e) => onPhone(e.target.value)}
          placeholder="Enter phone number" autoFocus={autoFocus}
          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm text-wa-lightText dark:text-slate-100 placeholder:text-wa-lightTextSecondary dark:placeholder:text-slate-500 focus:outline-none rounded-r-xl" />
      </div>
      {hint && <p className={`text-[11px] mt-1 ${mutedText}`}>{hint}</p>}

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel shadow-2xl overflow-hidden animate-fade-in">
          <div className="relative p-2 border-b border-wa-lightBorder dark:border-wa-darkBorder">
            <Search className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 ${mutedText}`} />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onListKey}
              role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={options[active] ? `${id}-opt-${active}` : undefined}
              aria-label="Search countries" placeholder="Search country or code"
              className="w-full rounded-lg pl-8 pr-3 py-2 text-sm bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-slate-100 placeholder:text-wa-lightTextSecondary dark:placeholder:text-slate-500 border border-wa-lightBorder dark:border-wa-darkBorder focus:outline-none focus:border-wa-green" />
          </div>
          <ul id={listId} role="listbox" aria-label="Countries" className="max-h-60 overflow-y-auto overscroll-contain py-1">
            {options.length === 0 && <li className={`px-4 py-3 text-sm ${mutedText}`}>No country matches.</li>}
            {options.map((c, i) => {
              const selected = c.iso === country.iso;
              return (
                <li key={`${c.iso}-${i}`} id={`${id}-opt-${i}`} role="option" aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${i === active ? 'bg-wa-green/10' : ''} ${
                    !query && i === SUGGESTED_ISOS.length ? 'border-t border-wa-lightBorder dark:border-wa-darkBorder' : ''}`}>
                  <Flag iso={c.iso} />
                  <span className={`flex-1 min-w-0 truncate ${bodyText} dark:text-slate-100`}>{c.name}</span>
                  <span className={`tabular-nums ${mutedText}`}>+{c.dial}</span>
                  {selected ? <Check className="w-4 h-4 text-wa-green" /> : <span className="w-4" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
