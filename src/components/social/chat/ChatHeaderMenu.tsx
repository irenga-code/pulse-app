import { useEffect, useRef, useState } from 'react';
import {
  Info, CheckSquare, BellOff, Bell, Timer, Palette, Heart, HeartOff, ListPlus, Download, X, Link, Users, ThumbsDown, Ban, Eraser, Trash2,
  ChevronDown, Check, Loader2, type LucideIcon,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { friendlyError } from '@/lib/api';
import { CHAT_THEMES, MUTE_OPTIONS, type ChatThemeId } from '@/lib/chatPrefs';

export type ChatHeaderAction =
  | { kind: 'info' } | { kind: 'mute'; ms: number | 'always' } | { kind: 'unmute' } | { kind: 'vanish' } | { kind: 'theme'; theme: ChatThemeId }
  | { kind: 'favorite' } | { kind: 'export' } | { kind: 'close' } | { kind: 'report' } | { kind: 'block' } | { kind: 'clear' } | { kind: 'delete' }
  | { kind: 'select' } | { kind: 'list' } | { kind: 'callLink' } | { kind: 'groupCall' };

/**
 * WhatsApp Web's ⋮ menu in the chat header, in its order: Contact info, Select messages, Mute notifications, Disappearing
 * messages, Chat theme, Add to Favorites, Add to list, Export chat, Close chat | Send call link, New group call | Report,
 * Block, Clear chat, Delete chat. Mute and Chat theme open in place (no side flyout, so it fits a phone). Every item
 * is live and styled alike.
 */
export default function ChatHeaderMenu({ muted, vanish, theme, favorite, blocked, onAction, onClose }: {
  muted: boolean; vanish: boolean; theme: ChatThemeId; favorite: boolean; blocked: boolean;
  onAction: (a: ChatHeaderAction) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<'mute' | 'theme' | null>(null);
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const pick = (a: ChatHeaderAction) => { onClose(); onAction(a); };
  const item = `w-full flex items-center gap-3.5 px-4 py-2.5 text-sm text-left hover:bg-black/5 dark:hover:bg-white/5 ${bodyText}`;
  const sub = `w-full flex items-center gap-3 pl-12 pr-4 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/5 ${bodyText}`;
  const icon = `w-[18px] h-[18px] flex-shrink-0 ${mutedText}`;
  const rule = <div role="separator" className="my-1.5 border-t border-wa-lightBorder dark:border-wa-darkBorder" />;
  const Item = ({ Icon, label, a }: { Icon: LucideIcon; label: string; a: ChatHeaderAction }) => (
    <button type="button" role="menuitem" className={item} onClick={() => pick(a)}><Icon className={icon} />{label}</button>
  );
  const Expand = ({ Icon, label, which, hint }: { Icon: LucideIcon; label: string; which: 'mute' | 'theme'; hint?: string }) => (
    <button type="button" role="menuitem" aria-expanded={open === which} className={item} onClick={() => setOpen((o) => (o === which ? null : which))}>
      <Icon className={icon} />{label}
      {hint && <span className={`ml-auto text-[11px] ${mutedText}`}>{hint}</span>}
      <ChevronDown className={`w-4 h-4 ${hint ? '' : 'ml-auto'} ${mutedText} transition-transform ${open === which ? 'rotate-180' : ''}`} />
    </button>
  );

  return (
    <div ref={ref} role="menu" aria-label="Chat menu"
      className="absolute right-0 top-full mt-1 z-30 w-64 max-h-[calc(100dvh-5rem)] overflow-y-auto py-2 rounded-xl bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-2xl border border-wa-lightBorder dark:border-wa-darkBorder animate-fade-in">
      <Item Icon={Info} label="Contact info" a={{ kind: 'info' }} />
      <Item Icon={CheckSquare} label="Select messages" a={{ kind: 'select' }} />
      {muted ? <Item Icon={Bell} label="Unmute notifications" a={{ kind: 'unmute' }} /> : (
        <>
          <Expand Icon={BellOff} label="Mute notifications" which="mute" />
          {open === 'mute' && MUTE_OPTIONS.map((o) => (
            <button key={o.label} type="button" role="menuitem" className={sub} onClick={() => pick({ kind: 'mute', ms: o.ms })}>{o.label}</button>
          ))}
        </>
      )}
      <button type="button" role="menuitemcheckbox" aria-checked={vanish} className={item} onClick={() => pick({ kind: 'vanish' })}>
        <Timer className={icon} />Disappearing messages<span className={`ml-auto text-[11px] ${vanish ? 'text-wa-green font-semibold' : mutedText}`}>{vanish ? 'On' : 'Off'}</span>
      </button>
      <Expand Icon={Palette} label="Chat theme" which="theme" hint={CHAT_THEMES.find((t) => t.id === theme)?.label} />
      {open === 'theme' && CHAT_THEMES.map((t) => (
        <button key={t.id} type="button" role="menuitemradio" aria-checked={theme === t.id} className={sub} onClick={() => pick({ kind: 'theme', theme: t.id })}>
          <span className="w-4 h-4 rounded-full border border-black/10 dark:border-white/20 flex-shrink-0" style={{ backgroundColor: t.swatch }} />
          {t.label}{theme === t.id && <Check className="w-4 h-4 ml-auto text-wa-green" />}
        </button>
      ))}
      <Item Icon={favorite ? HeartOff : Heart} label={favorite ? 'Remove from Favorites' : 'Add to Favorites'} a={{ kind: 'favorite' }} />
      <Item Icon={ListPlus} label="Add to list" a={{ kind: 'list' }} />
      <Item Icon={Download} label="Export chat" a={{ kind: 'export' }} />
      <Item Icon={X} label="Close chat" a={{ kind: 'close' }} />
      {rule}
      <Item Icon={Link} label="Send call link" a={{ kind: 'callLink' }} />
      <Item Icon={Users} label="New group call" a={{ kind: 'groupCall' }} />
      {rule}
      <Item Icon={ThumbsDown} label="Report" a={{ kind: 'report' }} />
      <Item Icon={Ban} label={blocked ? 'Unblock' : 'Block'} a={{ kind: 'block' }} />
      <Item Icon={Eraser} label="Clear chat" a={{ kind: 'clear' }} />
      <Item Icon={Trash2} label="Delete chat" a={{ kind: 'delete' }} />
    </div>
  );
}

/** Confirmation for the menu's Block / Unblock, Clear chat and Delete chat (same wording as Contact info). */
export function ConfirmChatModal({ kind, name, blocked, onConfirm, onClose }: {
  kind: 'block' | 'clear' | 'delete'; name: string; blocked: boolean; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };
  const title = kind === 'block' ? `${blocked ? 'Unblock' : 'Block'} ${name}?` : kind === 'clear' ? 'Clear this chat?' : 'Delete this chat?';
  const text = kind === 'block'
    ? blocked ? 'You can message each other again.' : `Neither of you can message the other until you unblock. ${name} is not told.`
    : kind === 'clear'
      ? `Messages disappear from this device only; ${name} still has them.`
      : `It leaves your list on this device until a new message arrives; ${name} still has the messages.`;
  const btn = 'rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2';
  return (
    <Modal title={title} icon={kind === 'block' ? Ban : kind === 'clear' ? Eraser : Trash2} onClose={onClose}>
      <p className={`text-sm ${mutedText}`}>{text}</p>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`${btn} text-wa-green hover:bg-wa-green/10`}>Cancel</button>
        <button type="button" disabled={busy} onClick={run} className={`${btn} bg-wa-live text-white hover:opacity-90`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{kind === 'block' ? (blocked ? 'Unblock' : 'Block') : kind === 'clear' ? 'Clear chat' : 'Delete chat'}
        </button>
      </div>
    </Modal>
  );
}
