import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  X, Pencil, Phone, Video, Search, Star, BellOff, Timer, ShieldAlert, Palette, Lock, Heart, ListPlus, Download, Eraser, Ban,
  ThumbsDown, Trash2, Check, Loader2,
} from 'lucide-react';
import { contactLabel, saveContact, useContacts, NOTE_MAX } from '@/lib/contacts';
import { formatDateTime } from '@/lib/time';
import type { ChatMessage } from '@/lib/types';
import Avatar from '@/components/Avatar';
import ReportModal from '@/components/community/ReportModal';
import { Toggle } from '@/components/settings/SettingsUi';
import { inputClass, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { exportChat as downloadChat } from '@/lib/exportChat';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  CHAT_THEMES, NO_CALLS, NO_LISTS, clearChat, deleteChat, getChatPrefs, isMutedIn, setChatMuted, setChatTheme, subscribeChatPrefs,
} from '@/lib/chatPrefs';
import type { ChatMeta } from '@/components/social/ChatThread';


function Row({ icon: Icon, label, hint, trailing, onClick, danger }: {
  icon: typeof Star; label: string; hint?: ReactNode; trailing?: ReactNode; onClick?: () => void; danger?: boolean;
}) {
  const body = (
    <>
      <Icon className={`w-5 h-5 flex-shrink-0 ${danger ? 'text-wa-live' : mutedText}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] ${danger ? 'text-wa-live' : bodyText}`}>{label}</span>
        {hint && <span className={`block text-xs mt-0.5 ${mutedText}`}>{hint}</span>}
      </span>
      {trailing}
    </>
  );
  const cls = 'w-full flex items-center gap-5 px-6 py-3.5 text-left';
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

const block = 'bg-wa-lightPanel dark:bg-wa-darkPanel';

/** WhatsApp Web "Contact info": who you are talking to, chat options, and destructive actions at the bottom. */
export default function ContactInfoDrawer({ otherUserId, meta, favorite, onFavorite, onSearch, onClose, onDeleted, onBlockedChange }: {
  otherUserId: string; meta: ChatMeta | null; favorite: boolean; onFavorite: (on: boolean) => Promise<void>;
  onSearch: () => void; onClose: () => void; onDeleted: () => void; onBlockedChange?: (blocked: boolean) => void;
}) {
  const { user } = useAuth();
  const { show } = useToast();
  const device = useSyncExternalStore(subscribeChatPrefs, getChatPrefs, getChatPrefs);
  const [themes, setThemes] = useState(false);
  const [confirm, setConfirm] = useState<'clear' | 'delete' | 'block' | null>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.resolve().then(() => api.myBlockedIds(user.id)).then((ids) => { if (alive) setBlocked(ids.includes(otherUserId)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [user, otherUserId]);
  const [reporting, setReporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stars, setStars] = useState<Pick<ChatMessage, 'id' | 'body' | 'sender_id' | 'created_at'>[] | null>(null);
  const [showStars, setShowStars] = useState(false);
  const loadStars = async () => {
    if (showStars) { setShowStars(false); return; }
    setShowStars(true);
    setStars(null);
    try { setStars(meta ? await api.starredMessages(meta.conversationId) : []); } catch (e) { setStars([]); show(friendlyError(e), 'error'); }
  };
  const [about, setAbout] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setAbout(undefined);
    api.getProfile(otherUserId).then((p) => { if (alive) setAbout(p?.bio ?? null); }).catch(() => { if (alive) setAbout(null); });
    return () => { alive = false; };
  }, [otherUserId]);
  const conv = meta?.conversationId ?? null;
  const other = meta?.other ?? null;
  const contacts = useContacts();
  const label = contactLabel(contacts[otherUserId], other?.display_name);
  const name = label.title;
  const [editing, setEditing] = useState<string | null>(null);
  const saveName = (e: React.FormEvent) => {
    e.preventDefault();
    saveContact(otherUserId, { name: (editing ?? '').slice(0, 40) });
    setEditing(null);
    show('Contact saved');
  };
  const muted = isMutedIn(device, conv);
  const theme = (conv && device.themes[conv]) || 'default';

  const exportChat = async () => {
    if (!conv) return;
    setExporting(true);
    try {
      await downloadChat(conv, name, user?.id, device.clearedAt[conv]);
      show('Chat exported');
    } catch (e) {
      show(friendlyError(e), 'error');
    }
    setExporting(false);
  };

  return (
    <aside aria-label="Contact info" className="flex flex-col h-full min-h-0 bg-wa-lightSecondary dark:bg-wa-dark border-l border-wa-lightBorder dark:border-wa-darkBorder">
      <header className={`flex items-center gap-6 px-6 h-[60px] flex-shrink-0 ${block}`}>
        <button type="button" onClick={onClose} aria-label="Close contact info" className={`p-1 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${mutedText}`}><X className="w-5 h-5" /></button>
        <h2 className={`flex-1 text-base font-medium ${bodyText}`}>Contact info</h2>
        <button type="button" onClick={() => setEditing(editing === null ? contacts[otherUserId]?.name ?? other?.display_name ?? '' : null)}
          aria-label="Edit contact name" title="Edit contact name" aria-pressed={editing !== null}
          className={`p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${editing !== null ? 'text-wa-green' : mutedText}`}><Pencil className="w-5 h-5" /></button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-6">
        <section className={`${block} flex flex-col items-center px-6 pt-7 pb-5 text-center`}>
          <Avatar name={contacts[otherUserId]?.name ?? other?.display_name ?? name} url={other?.avatar_url} size={200} />
          {editing !== null ? (
            <form onSubmit={saveName} className="mt-4 w-full flex gap-2">
              <input value={editing} onChange={(e) => setEditing(e.target.value.slice(0, 40))} autoFocus aria-label="Contact name"
                placeholder="Name for this contact" className={`${inputClass} text-center`} />
              <button type="submit" aria-label="Save contact name" className="px-3 rounded-xl bg-wa-green text-white"><Check className="w-4 h-4" /></button>
            </form>
          ) : (
            <p className={`mt-4 text-2xl break-words ${bodyText}`}>{name}</p>
          )}
          {/* the number you reached them on (only you know it); Pulse never reveals anyone's number */}
          <p className={`text-[15px] mt-1 tabular-nums ${mutedText}`} data-testid="contact-phone">{label.phone ?? 'Phone number private'}</p>
          {label.phone && other && label.title !== other.display_name && <p className={`text-xs mt-0.5 ${mutedText}`}>~{other.display_name} on Pulse</p>}
          <div className="flex justify-center gap-7 w-full mt-5">
            {[
              { icon: Phone, label: 'Voice', title: 'Voice call', onClick: () => show(NO_CALLS) },
              { icon: Video, label: 'Video', title: 'Video call', onClick: () => show(NO_CALLS) },
              { icon: Search, label: 'Search', title: 'Search messages', onClick: onSearch },
            ].map((a) => (
              <span key={a.label} className="flex flex-col items-center gap-1.5">
                <button type="button" onClick={a.onClick} title={a.title} aria-label={a.title}
                  className="w-14 h-14 rounded-full flex items-center justify-center bg-wa-green/10 text-wa-green ring-1 ring-wa-green/30 hover:bg-wa-green/20 transition-colors">
                  <a.icon className="w-6 h-6" />
                </button>
                <span className={`text-xs ${bodyText}`}>{a.label}</span>
              </span>
            ))}
          </div>
        </section>

        {about !== undefined && (
          <section className={`${block} px-6 py-4`}>
            <p className={`text-sm ${mutedText}`}>About</p>
            <p className={`text-[15px] mt-1 whitespace-pre-wrap break-words ${bodyText}`}>{about || 'Hey there! I am using Pulse.'}</p>
          </section>
        )}

        <section className={`${block} px-6 py-4`}>
          <label htmlFor="contact-note" className={`block text-sm ${mutedText}`}>Notes</label>
          <textarea id="contact-note" value={contacts[otherUserId]?.note ?? ''} rows={3}
            onChange={(e) => saveContact(otherUserId, { note: e.target.value.slice(0, NOTE_MAX) })}
            placeholder="Private notes about this contact. Use “Add text to note” on a message to add it here."
            className={`${inputClass} mt-1.5 resize-y text-sm`} />
          <p className={`text-[11px] mt-1 ${mutedText}`}>Only you can see this. Saved on this device.</p>
        </section>

        <section className={block}>
          <Row icon={Star} label="Starred messages" onClick={loadStars} hint={showStars && stars ? `${stars.length} starred` : undefined} />
          {showStars && (
            <ul className="px-6 pb-3 space-y-2" aria-label="Starred messages">
              {stars === null ? <li className={`text-sm ${mutedText}`}>Loading…</li>
                : stars.length === 0 ? <li className={`text-sm ${mutedText}`}>No starred messages. Star one from its ⌄ menu.</li>
                : stars.map((m) => (
                  <li key={m.id} className="rounded-lg px-3 py-2 bg-black/[0.03] dark:bg-white/5">
                    <p className={`text-xs font-medium ${m.sender_id === user?.id ? 'text-wa-green' : bodyText}`}>{m.sender_id === user?.id ? 'You' : name}</p>
                    <p className={`text-sm whitespace-pre-wrap break-words ${bodyText}`}>{m.body}</p>
                    <p className={`text-[11px] mt-0.5 ${mutedText}`}>{formatDateTime(m.created_at)}</p>
                  </li>
                ))}
            </ul>
          )}
          <Row icon={BellOff} label="Mute notifications" hint="No sound or pop-ups for this chat on this device"
            trailing={<Toggle checked={muted} disabled={!conv} label="Mute notifications" onChange={(on) => { if (conv) { setChatMuted(conv, on); show(on ? 'Chat muted' : 'Chat unmuted'); } }} />} />
          <Row icon={Timer} label="Disappearing messages" hint={meta?.vanish ? 'On: messages vanish after they are read' : 'Off'}
            trailing={<Toggle checked={!!meta?.vanish} disabled={!meta} label="Disappearing messages" onChange={() => meta?.toggleVanish()} />} />
          <Row icon={ShieldAlert} label="Restricted chat" onClick={() => show('Restricted chats are not available in Pulse yet. Mute or archive the chat instead.')} />
          <Row icon={Palette} label="Chat theme" hint={CHAT_THEMES.find((t) => t.id === theme)?.label} onClick={() => setThemes((v) => !v)} />
          {themes && conv && (
            <div role="radiogroup" aria-label="Chat theme" className="flex flex-wrap gap-3 px-6 pb-4">
              {CHAT_THEMES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} aria-label={t.label} title={t.label} onClick={() => setChatTheme(conv, t.id)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-wa-lightPanel dark:ring-offset-wa-darkPanel ${theme === t.id ? 'ring-wa-green' : 'ring-transparent'}`}
                  style={{ backgroundColor: t.swatch }}>
                  {theme === t.id && <Check className="w-4 h-4 text-white drop-shadow" strokeWidth={3} />}
                </button>
              ))}
            </div>
          )}
          <Row icon={Lock} label="Privacy" hint="Messages are private to this chat. Encrypted in transit and stored securely; not end-to-end encrypted." />
        </section>

        <section className={block}>
          <Row icon={Heart} label={favorite ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => { void onFavorite(!favorite); }}
            trailing={favorite ? <Heart className="w-4 h-4 fill-wa-green text-wa-green" /> : undefined} />
          <Row icon={ListPlus} label="Add to list" onClick={() => show(NO_LISTS)} />
          <Row icon={Download} label="Export chat" hint="Download this chat as a text file" onClick={exportChat}
            trailing={exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined} />
        </section>

        <section className={block}>
          {confirm ? (
            <div className="px-6 py-4 space-y-3">
              <p className={`text-sm ${bodyText}`}>
                {confirm === 'block'
                  ? blocked ? `Unblock ${name}? You can message each other again.` : `Block ${name}? Neither of you can message the other until you unblock. ${name} is not told.`
                  : confirm === 'clear'
                    ? `Clear this chat? Messages disappear from this device only; ${name} still has them.`
                    : `Delete this chat? It leaves your list on this device until a new message arrives; ${name} still has the messages.`}
              </p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setConfirm(null)} className={`px-4 py-2 rounded-full text-sm font-medium text-wa-green hover:bg-wa-green/10`}>Cancel</button>
                <button type="button" className="px-4 py-2 rounded-full text-sm font-medium bg-wa-live text-white hover:opacity-90"
                  onClick={async () => {
                    if (confirm === 'block') {
                      if (!user) return;
                      try {
                        await api.setBlocked(user.id, otherUserId, !blocked);
                        show(blocked ? `${name} unblocked` : `${name} blocked`);
                        setBlocked(!blocked);
                        onBlockedChange?.(!blocked);
                      } catch (e) { show(friendlyError(e), 'error'); }
                      setConfirm(null);
                      return;
                    }
                    if (!conv) return;
                    if (confirm === 'delete') {
                      deleteChat(conv);
                      show('Chat deleted');
                      onDeleted();
                    } else {
                      clearChat(conv);
                      show('Chat cleared');
                    }
                    setConfirm(null);
                  }}>
                  {confirm === 'block' ? (blocked ? 'Unblock' : 'Block') : confirm === 'clear' ? 'Clear chat' : 'Delete chat'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <Row icon={Eraser} label="Clear chat" danger onClick={() => setConfirm('clear')} />
              <Row icon={Ban} label={`${blocked ? 'Unblock' : 'Block'} ${name}`} danger onClick={() => setConfirm('block')} />
              <Row icon={ThumbsDown} label={`Report ${name}`} danger onClick={() => setReporting(true)} />
              <Row icon={Trash2} label="Delete chat" danger onClick={() => setConfirm('delete')} />
            </>
          )}
        </section>
      </div>
      {reporting && <ReportModal targetType="user" targetId={otherUserId} onClose={() => setReporting(false)} />}
    </aside>
  );
}
