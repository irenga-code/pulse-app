import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

type Toast = { id: number; message: string; kind: 'success' | 'error' };
type ToastContextValue = { show: (message: string, kind?: Toast['kind']) => void };

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed z-[60] left-0 right-0 bottom-20 md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-2 max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-xl bg-wa-darkSecondary text-wa-darkText border border-wa-darkBorder animate-slide-up"
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-wa-green flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-wa-live flex-shrink-0" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
