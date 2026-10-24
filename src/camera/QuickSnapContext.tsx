import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { SnapDestination } from '@/camera/useSnapDispatch';

// the camera is a big module: only load it when someone opens it
const CameraModal = lazy(() => import('@/camera/CameraModal'));

type QuickSnapOptions = {
  /** Send straight here (a chat's camera button) instead of showing Send to. */
  destination?: SnapDestination;
  initialVenueId?: string | null;
  onSent?: (sent: SnapDestination[]) => void;
};

const QuickSnapContext = createContext<{ openQuickSnap: (opts?: QuickSnapOptions) => void }>({ openQuickSnap: () => undefined });

/** One app-wide Quick-Snap camera: the header, the rail and chat composers all open it. */
export function QuickSnapProvider({ children }: { children: ReactNode }) {
  const { requireAuth } = useAuth();
  const [open, setOpen] = useState<QuickSnapOptions | null>(null);
  const openQuickSnap = useCallback((opts: QuickSnapOptions = {}) => {
    if (requireAuth('Sign in to send snaps.')) setOpen(opts);
  }, [requireAuth]);
  const value = useMemo(() => ({ openQuickSnap }), [openQuickSnap]);

  return (
    <QuickSnapContext.Provider value={value}>
      {children}
      {open && (
        <Suspense fallback={null}>
          <CameraModal onClose={() => setOpen(null)} destination={open.destination} initialVenueId={open.initialVenueId} onSent={open.onSent} />
        </Suspense>
      )}
    </QuickSnapContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useQuickSnap = () => useContext(QuickSnapContext);
