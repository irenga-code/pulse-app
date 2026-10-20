import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';

type Props = {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: ReactNode;
};

/** Bottom sheet on mobile, centered dialog on desktop. Esc / backdrop click closes. */
export default function Modal({ title, icon: Icon, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full md:max-w-lg max-h-[88vh] flex flex-col bg-wa-lightPanel dark:bg-wa-darkPanel rounded-t-3xl md:rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder shadow-2xl outline-none animate-slide-up"
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-wa-lightBorder dark:border-wa-darkBorder flex-shrink-0">
          {Icon && <Icon className="w-5 h-5 text-wa-green" />}
          <h2 className="text-base font-bold text-wa-lightText dark:text-wa-darkText flex-1">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
