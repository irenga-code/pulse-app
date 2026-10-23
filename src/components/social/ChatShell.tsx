import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '@/lib/scrollLock';

/** Full-screen on phones, a centered card on desktop. Leaves room for the emoji sheet (see EmojiButton). */
export default function ChatShell({ label, onClose, secret = false, children }: { label: string; onClose: () => void; secret?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const unlock = lockBodyScroll();
    return () => { window.removeEventListener('keydown', onKey); unlock(); };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[48] md:flex md:items-center md:justify-center md:bg-black/60 md:backdrop-blur-sm animate-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex flex-col w-full h-full md:h-[min(720px,90vh)] md:max-w-md md:rounded-2xl overflow-hidden md:border md:shadow-2xl transition-colors duration-300 ${
          secret
            ? 'bg-zinc-950 text-zinc-100 md:border-purple-500/40'
            : 'bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText md:border-wa-lightBorder md:dark:border-wa-darkBorder'
        }`}
        style={{ paddingBottom: 'var(--emoji-sheet, 0px)' }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
