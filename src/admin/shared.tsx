import type { AccountStatus } from '@/lib/types';

const statusClass: Record<string, string> = {
  active: 'bg-wa-green/15 text-wa-green',
  suspended: 'bg-wa-busy/15 text-wa-busy',
  banned: 'bg-wa-live/15 text-wa-live',
  open: 'bg-wa-busy/15 text-wa-busy',
  actioned: 'bg-wa-green/15 text-wa-green',
  dismissed: 'bg-wa-quiet/15 text-wa-quiet',
  pending: 'bg-wa-busy/15 text-wa-busy',
  approved: 'bg-wa-green/15 text-wa-green',
  rejected: 'bg-wa-live/15 text-wa-live',
};

export function StatusChip({ status }: { status: AccountStatus | string }) {
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${statusClass[status] ?? 'bg-wa-quiet/15 text-wa-quiet'}`}>
      {status}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-wa-light dark:bg-wa-dark text-wa-lightTextSecondary dark:text-wa-darkTextSecondary border border-wa-lightBorder dark:border-wa-darkBorder">
      {children}
    </span>
  );
}

export const panelCard =
  'bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-4 border border-wa-lightBorder dark:border-wa-darkBorder';

export function FilterToggle<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl p-0.5 bg-wa-lightPanel dark:bg-wa-darkSecondary border border-wa-lightBorder dark:border-wa-darkBorder">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-wa-green text-white' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
