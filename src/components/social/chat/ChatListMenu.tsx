import { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, BellOff, Bell, ChevronRight, Pin, PinOff, MessageSquareDot, CheckCheck, Heart, HeartOff, ListPlus, Ban,
  MinusCircle, Trash2,
} from 'lucide-react';
import { MUTE_OPTIONS } from '@/lib/chatPrefs';
import { mutedText, bodyText } from '@/components/ui';

export type ChatListAction =
  | { kind: 'archive' } | { kind: 'mute'; ms: number | 'always' } | { kind: 'unmute' } | { kind: 'pin' }
  | { kind: 'unread' } | { kind: 'read' } | { kind: 'favorite' } | { kind: 'block' } | { kind: 'clear' } | { kind: 'delete' };

/**
 * WhatsApp's chat context menu: Archive, Mute (8 hours / 1 week / Always), Pin, Mark as unread, Favorites, Add to list,
 * then Block, Clear chat, Delete chat.
 */
export default function ChatListMenu({ archived, muted, pinned, unread, favorite, blocked, onAction, onClose }: {
  archived: boolean; muted: boolean; pinned: boolean; unread: boolean; favorite: boolean; blocked: boolean;
  onAction: (a: ChatListAction) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const pick = (a: ChatListAction) => { onClose(); onAction(a); };
  const item = `w-full flex items-center gap-3.5 px-4 py-2.5 text-sm text-left hover:bg-black/5 dark:hover:bg-white/5 ${bodyText}`;
  const icon = `w-[18px] h-[18px] flex-shrink-0 ${mutedText}`;

  return (
    <div ref={ref} role="menu" aria-label="Chat options"
      className="absolute right-2 top-full -mt-2 z-30 w-60 py-2 rounded-xl bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-2xl border border-wa-lightBorder dark:border-wa-darkBorder animate-fade-in">
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'archive' })}>
        {archived ? <ArchiveRestore className={icon} /> : <Archive className={icon} />}{archived ? 'Unarchive chat' : 'Archive chat'}
      </button>
      {muted ? (
        <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'unmute' })}>
          <Bell className={icon} />Unmute notifications
        </button>
      ) : (
        <div className="relative" onMouseLeave={() => setMuteOpen(false)}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={muteOpen} className={item}
            onClick={() => setMuteOpen((v) => !v)} onMouseEnter={() => setMuteOpen(true)}>
            <BellOff className={icon} />Mute notifications<ChevronRight className={`w-4 h-4 ml-auto ${mutedText}`} />
          </button>
          {muteOpen && (
            <div role="menu" aria-label="Mute for"
              className="absolute right-full top-0 mr-1 z-40 w-44 py-1.5 rounded-xl bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-2xl border border-wa-lightBorder dark:border-wa-darkBorder">
              {MUTE_OPTIONS.map((o) => (
                <button key={o.label} type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'mute', ms: o.ms })}>{o.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'pin' })}>
        {pinned ? <PinOff className={icon} /> : <Pin className={icon} />}{pinned ? 'Unpin chat' : 'Pin chat'}
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: unread ? 'read' : 'unread' })}>
        {unread ? <CheckCheck className={icon} /> : <MessageSquareDot className={icon} />}{unread ? 'Mark as read' : 'Mark as unread'}
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'favorite' })}>
        {favorite ? <HeartOff className={icon} /> : <Heart className={icon} />}{favorite ? 'Remove from Favorites' : 'Add to Favorites'}
      </button>
      <div role="menuitem" aria-disabled="true" title="Coming soon" className={`${item} opacity-50 cursor-default hover:bg-transparent`}>
        <ListPlus className={icon} />Add to list<span className={`ml-auto text-[10px] font-semibold uppercase ${mutedText}`}>Soon</span>
      </div>
      <hr className="my-1.5 border-wa-lightBorder dark:border-wa-darkBorder" role="separator" />
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'block' })}>
        <Ban className={icon} />{blocked ? 'Unblock' : 'Block'}
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'clear' })}>
        <MinusCircle className={icon} />Clear chat
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => pick({ kind: 'delete' })}>
        <Trash2 className={icon} />Delete chat
      </button>
    </div>
  );
}
