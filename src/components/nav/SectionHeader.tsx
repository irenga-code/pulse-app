import type { ReactNode } from 'react';
import { Camera } from 'lucide-react';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { bodyText, mutedText } from '@/components/ui';

export const headerIconBtn = 'p-2 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green hover:bg-wa-green/10 transition-colors';

/** Title row of every section screen, with the Quick-Snap camera launcher on the right. */
export default function SectionHeader({ title, subtitle, actions, camera = true }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  camera?: boolean;
}) {
  const { openQuickSnap } = useQuickSnap();
  return (
    <div className="px-4 md:px-6 pt-4 pb-2">
      <div className="flex items-center gap-1">
        <h1 className={`text-2xl font-bold flex-1 truncate ${bodyText}`}>{title}</h1>
        {actions}
        {camera && (
          <button onClick={() => openQuickSnap()} aria-label="Quick-Snap camera" title="Quick-Snap: tap for photo, hold for video" className={headerIconBtn}>
            <Camera className="w-6 h-6" />
          </button>
        )}
      </div>
      {subtitle && <p className={`text-sm mt-0.5 ${mutedText}`}>{subtitle}</p>}
    </div>
  );
}
