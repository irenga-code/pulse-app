import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Info, Reply, Copy, SmilePlus, Forward, Pin, PinOff, Star, StarOff, NotebookPen, Flag, Trash2, Search, Check, Loader2, X,
} from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import { EmojiPanel } from '@/components/emoji/EmojiPicker';
import { ErrorNote, inputClass, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { formatDateTime } from '@/lib/time';
import { contactLabel, useContacts } from '@/lib/contacts';
import type { ChatMessage, ConversationSummary, MessageMedia, PublicProfile } from '@/lib/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Close a popover when clicking outside it or pressing Escape. */
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return ref;
}

/** WhatsApp's floating quick-reaction pill: six emojis and "+" for the full picker. */
export function QuickReactions({ current, onPick, onClose, align }: {
  current: string | null; onPick: (emoji: string) => void; onClose: () => void; align: 'left' | 'right';
}) {
  const [more, setMore] = useState(false);
  const ref = useDismiss(onClose);
  return (
    <div ref={ref} className={`absolute bottom-full mb-1.5 z-30 ${align === 'right' ? 'right-0' : 'left-0'}`}>
      <div role="toolbar" aria-label="React to message" className="flex items-center gap-0.5 rounded-full px-1.5 py-1 bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-xl border border-wa-lightBorder dark:border-wa-darkBorder animate-fade-in">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => { onPick(e); onClose(); }} aria-label={`React ${e}`} aria-pressed={current === e}
            className={`w-9 h-9 flex items-center justify-center rounded-full text-[22px] leading-none transition-transform hover:scale-125 ${current === e ? 'bg-black/10 dark:bg-white/15' : ''}`}>
            {e}
          </button>
        ))}
        <button type="button" onClick={() => setMore((v) => !v)} aria-label="More reactions" aria-expanded={more}
          className={`w-9 h-9 flex items-center justify-center rounded-full bg-black/5 dark:bg-white/10 ${mutedText} hover:text-wa-green`}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
      {more && (
        <div className={`absolute top-full mt-1 z-40 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <EmojiPanel onPick={(e) => { onPick(e); onClose(); }} />
        </div>
      )}
    </div>
  );
}

export type MessageAction = 'info' | 'reply' | 'copy' | 'react' | 'forward' | 'pin' | 'star' | 'note' | 'report' | 'delete';

/** The message dropdown: Message info, Reply, Copy, React, Forward, Pin, Star, Add text to note, Report, Delete. */
export function MessageMenu({ mine, hasText, canForward, pinned, starred, onAction, onClose, align }: {
  mine: boolean; hasText: boolean; canForward: boolean; pinned: boolean; starred: boolean;
  onAction: (a: MessageAction) => void; onClose: () => void; align: 'left' | 'right';
}) {
  const ref = useDismiss(onClose);
  const items: { id: MessageAction; label: string; icon: typeof Info; show: boolean; danger?: boolean }[] = [
    { id: 'info', label: 'Message info', icon: Info, show: true },
    { id: 'reply', label: 'Reply', icon: Reply, show: true },
    { id: 'copy', label: 'Copy text', icon: Copy, show: hasText },
    { id: 'react', label: 'React', icon: SmilePlus, show: true },
    { id: 'forward', label: 'Forward', icon: Forward, show: canForward },
    { id: 'pin', label: pinned ? 'Unpin message' : 'Pin message', icon: pinned ? PinOff : Pin, show: true },
    { id: 'star', label: starred ? 'Unstar message' : 'Star message', icon: starred ? StarOff : Star, show: true },
    { id: 'note', label: 'Add text to note', icon: NotebookPen, show: hasText },
    { id: 'report', label: 'Report', icon: Flag, show: !mine },
    { id: 'delete', label: 'Delete', icon: Trash2, show: true, danger: true },
  ];
  return (
    <div ref={ref} role="menu" aria-label="Message options"
      className={`absolute top-6 z-30 min-w-52 py-1.5 rounded-xl bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-2xl border border-wa-lightBorder dark:border-wa-darkBorder animate-fade-in ${align === 'right' ? 'right-0' : 'left-0'}`}>
      {items.filter((i) => i.show).map((i) => (
        <button key={i.id} type="button" role="menuitem" onClick={() => { onClose(); onAction(i.id); }}
          className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/5 ${i.danger ? 'text-wa-live' : bodyText}`}>
          <i.icon className={`w-4 h-4 ${i.danger ? '' : mutedText}`} />{i.label}
        </button>
      ))}
    </div>
  );
}

/** "Delete message?" with Delete for everyone (your own messages only), Delete for me, Cancel. */
export function DeleteMessageModal({ canDeleteForEveryone, onEveryone, onMe, onClose, count = 1 }: {
  canDeleteForEveryone: boolean; onEveryone: () => Promise<void>; onMe: () => Promise<void>; onClose: () => void;
  /** several messages picked with "Select messages" */
  count?: number;
}) {
  const [busy, setBusy] = useState<'everyone' | 'me' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (which: 'everyone' | 'me') => {
    setBusy(which);
    setError(null);
    try {
      await (which === 'everyone' ? onEveryone() : onMe());
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(null);
    }
  };
  const btn = 'w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2';
  return (
    <Modal title={count > 1 ? `Delete ${count} messages?` : 'Delete message?'} icon={Trash2} onClose={onClose}>
      <p className={`text-sm ${mutedText}`}>
        {canDeleteForEveryone ? 'Delete for everyone removes it for both of you.' : `This removes ${count > 1 ? 'them' : 'the message'} from your chat only.`}
      </p>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      <div className="mt-5 space-y-2">
        {canDeleteForEveryone && (
          <button type="button" disabled={!!busy} onClick={() => run('everyone')} className={`${btn} bg-wa-live text-white hover:opacity-90`}>
            {busy === 'everyone' && <Loader2 className="w-4 h-4 animate-spin" />}Delete for everyone
          </button>
        )}
        <button type="button" disabled={!!busy} onClick={() => run('me')} className={`${btn} border border-wa-lightBorder dark:border-wa-darkBorder text-wa-green hover:bg-wa-green/10`}>
          {busy === 'me' && <Loader2 className="w-4 h-4 animate-spin" />}Delete for me
        </button>
        <button type="button" disabled={!!busy} onClick={onClose} className={`${btn} ${mutedText} hover:bg-black/5 dark:hover:bg-white/5`}>Cancel</button>
      </div>
    </Modal>
  );
}

/** When it was sent, read and (secret mode) when it vanishes. */
export function MessageInfoModal({ message, mine, onClose }: { message: ChatMessage; mine: boolean; onClose: () => void }) {
  const row = (label: string, value: string) => (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className={`text-sm ${mutedText}`}>{label}</span>
      <span className={`text-sm text-right ${bodyText}`}>{value}</span>
    </div>
  );
  return (
    <Modal title="Message info" icon={Info} onClose={onClose}>
      <p className={`text-sm rounded-xl px-3 py-2.5 bg-wa-lightSecondary dark:bg-wa-darkSecondary whitespace-pre-wrap break-words ${bodyText}`}>{message.body}</p>
      <div className="mt-3 divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
        {row(mine ? 'Sent' : 'Received', formatDateTime(message.created_at))}
        {mine && row('Read', message.read_at ? formatDateTime(message.read_at) : 'Not read yet')}
        {message.is_forwarded && row('Forwarded', 'Yes')}
        {message.vanish && row('Secret mode', message.expires_at ? `Vanishes ${formatDateTime(message.expires_at)}` : 'Vanishes after it is read')}
      </div>
    </Modal>
  );
}

/** Forward a message to up to five of your other chats. Voice notes stay in the chat they were recorded for. */
export function ForwardModal({ message, currentConversationId, onClose, onDone }: {
  message: ChatMessage; currentConversationId: string; onClose: () => void; onDone: (count: number) => void;
}) {
  const contacts = useContacts();
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [people, setPeople] = useState<Record<string, PublicProfile>>({});
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = (await api.listConversations()).filter((c) => c.conversation_id !== currentConversationId);
        const ppl = await api.profilesByIds(list.map((c) => c.other_user_id));
        if (alive) { setRows(list); setPeople(ppl); }
      } catch (e) { if (alive) { setError(friendlyError(e)); setRows([]); } }
    })();
    return () => { alive = false; };
  }, [currentConversationId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((c) => !q || contactLabel(contacts[c.other_user_id], people[c.other_user_id]?.display_name).title.toLowerCase().includes(q));
  }, [rows, query, contacts, people]);

  const send = async () => {
    setBusy(true);
    setError(null);
    const media: MessageMedia | null = message.media_url && (message.media_type === 'image' || message.media_type === 'video')
      ? { media_url: message.media_url, media_type: message.media_type } : null;
    let ok = 0;
    for (const conv of picked) {
      try { await api.sendMessage(conv, message.body, null, media, { forwarded: true }); ok++; } catch (e) { setError(friendlyError(e)); }
    }
    setBusy(false);
    if (ok > 0) { onDone(ok); onClose(); }
  };

  return (
    <Modal title="Forward message to" icon={Forward} onClose={onClose}>
      <div className="relative">
        <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats to forward to" className={`${inputClass} pl-9`} autoFocus />
      </div>
      <ul className="mt-3 max-h-72 overflow-y-auto -mx-1" aria-label="Chats">
        {rows === null ? <li className={`px-3 py-4 text-sm ${mutedText}`}>Loading chats…</li>
          : shown.length === 0 ? <li className={`px-3 py-4 text-sm ${mutedText}`}>{rows.length === 0 ? 'No other chats yet.' : 'No chat matches.'}</li>
          : shown.map((c) => {
            const p = people[c.other_user_id];
            const label = contactLabel(contacts[c.other_user_id], p?.display_name);
            const on = picked.includes(c.conversation_id);
            return (
              <li key={c.conversation_id}>
                <button type="button" role="checkbox" aria-checked={on} disabled={!on && picked.length >= 5}
                  onClick={() => setPicked((s) => (on ? s.filter((x) => x !== c.conversation_id) : [...s, c.conversation_id]))}
                  className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40">
                  <Avatar name={contacts[c.other_user_id]?.name ?? p?.display_name ?? '?'} url={p?.avatar_url} size={40} />
                  <span className={`flex-1 min-w-0 truncate text-sm font-medium ${bodyText}`}>{label.title}</span>
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'bg-wa-green border-wa-green text-white' : 'border-wa-lightBorder dark:border-wa-darkBorder'}`}>
                    {on && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      <button type="button" onClick={send} disabled={busy || picked.length === 0} className={`${primaryBtn} w-full mt-3`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Forward className="w-4 h-4" />}
        Forward{picked.length > 0 ? ` to ${picked.length} chat${picked.length === 1 ? '' : 's'}` : ''}
      </button>
    </Modal>
  );
}

/** The bar above the composer while replying. */
export function ReplyBar({ name, text, onCancel }: { name: string; text: string; onCancel: () => void }) {
  return (
    <div className="flex items-stretch gap-2 mx-1 mb-2 rounded-lg overflow-hidden bg-black/5 dark:bg-white/5" data-testid="reply-bar">
      <span className="w-1 bg-wa-green flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 py-1.5">
        <span className="block text-xs font-semibold text-wa-green">Replying to {name}</span>
        <span className={`block text-xs truncate ${mutedText}`}>{text}</span>
      </span>
      <button type="button" onClick={onCancel} aria-label="Cancel reply" className={`px-2 ${mutedText} hover:text-wa-live`}><X className="w-4 h-4" /></button>
    </div>
  );
}
