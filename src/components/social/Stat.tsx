import { formatCount } from '@/lib/format';
import { mutedText, bodyText } from '@/components/ui';

/** One number under a label (followers, Vibe Rep, ...). */
export function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="flex-1 text-center">
      <p className={`text-lg font-bold flex items-center justify-center gap-1 ${bodyText}`}>{icon}{formatCount(value)}</p>
      <p className={`text-[11px] ${mutedText}`}>{label}</p>
    </div>
  );
}
