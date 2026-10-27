import { AlertCircle } from 'lucide-react';
import { ListSkeleton } from '@/components/Skeleton';

export const inputClass =
  'w-full rounded-xl px-3.5 py-2.5 text-sm bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText placeholder:text-wa-lightTextSecondary dark:placeholder:text-wa-darkTextSecondary border border-wa-lightBorder dark:border-wa-darkBorder focus:outline-none focus:border-wa-green transition-colors';
export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-wa-green text-white hover:bg-wa-greenDark disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightText dark:text-wa-darkText hover:border-wa-green disabled:opacity-50 transition-colors';
export const dangerBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-wa-live text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity';
export const mutedText = 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary';
export const bodyText = 'text-wa-lightText dark:text-wa-darkText';

/** First-load placeholder for lists and panels (cached data skips it entirely). */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <ListSkeleton rows={3} label={label} />;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs bg-wa-live/10 text-wa-live border border-wa-live/30" role="alert">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
      <span>{message}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={`block text-xs font-medium mb-1.5 ${bodyText}`}>{label}</span>
      {children}
      {hint && <span className={`block text-[11px] mt-1 ${mutedText}`}>{hint}</span>}
    </label>
  );
}
