import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { mutedText, bodyText } from '@/components/ui';

/** Pulse's settings surfaces: slate-900 cards with slate-800 dividers in dark mode, white cards in light mode. */
export const settingsCard = 'rounded-xl overflow-hidden bg-wa-lightPanel dark:bg-slate-900 border border-wa-lightBorder dark:border-slate-800';

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="text-[13px] font-semibold text-wa-green px-1 mb-2">{title}</h3>}
      <div className={`${settingsCard} divide-y divide-wa-lightBorder dark:divide-slate-800`}>{children}</div>
    </section>
  );
}

/** One settings line. With `onClick` it is a button (with a chevron unless it has its own trailing control). */
export function SettingsRow({ icon: Icon, title, description, trailing, onClick, expanded, danger }: {
  icon?: LucideIcon; title: ReactNode; description?: ReactNode; trailing?: ReactNode;
  onClick?: () => void; expanded?: boolean; danger?: boolean;
}) {
  const body = (
    <>
      {Icon && <Icon className={`w-5 h-5 flex-shrink-0 ${danger ? 'text-wa-live' : mutedText}`} />}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${danger ? 'text-wa-live' : bodyText}`}>{title}</span>
        {description && <span className={`block text-xs mt-0.5 ${mutedText}`}>{description}</span>}
      </span>
      {trailing}
      {onClick && !trailing && <ChevronRight className={`w-4 h-4 flex-shrink-0 ${mutedText} transition-transform ${expanded ? 'rotate-90' : ''}`} />}
    </>
  );
  const cls = 'w-full flex items-center gap-4 px-4 py-3.5 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} aria-expanded={expanded} className={`${cls} hover:bg-black/[0.03] dark:hover:bg-slate-800/60 transition-colors`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-wa-green/60 ${
        checked ? 'bg-wa-green' : 'bg-wa-lightBorder dark:bg-slate-700'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}
