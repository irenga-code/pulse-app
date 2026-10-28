import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, MessageCirclePlus, Loader2, LogIn, MessageCircle, EllipsisVertical, Archive, Star, Lock, Share2 } from 'lucide-react';
import Modal from '@/components/Modal';
import SectionHeader, { headerIconBtn } from '@/components/nav/SectionHeader';
import ConversationList, { type ChatFilter } from '@/components/social/ConversationList';
import ChatThread, { type ChatMeta } from '@/components/social/ChatThread';
import ContactInfoDrawer from '@/components/social/ContactInfoDrawer';
import CountryPhoneInput, { usePhoneCountry } from '@/components/auth/CountryPhoneInput';
import BrandLogo from '@/components/BrandLogo';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { joinE164, formatPhone } from '@/lib/phone';
import { saveContact } from '@/lib/contacts';
import { shareLink } from '@/lib/share';
import { ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocial } from '@/context/SocialContext';
import { useToast } from '@/context/ToastContext';

/** Start a chat with whoever has confirmed this number on Pulse (the number is matched, never shown). */
function NewChatByPhone({ onClose, initialPhone = '', onFound }: { onClose: () => void; initialPhone?: string; onFound?: (userId: string) => void }) {
  const { openChat } = useSocial();
  const { user } = useAuth();
  const { show } = useToast();
  const [notOnPulse, setNotOnPulse] = useState<string | null>(null);
  const { country, setIso } = usePhoneCountry();
  const [phone, setPhone] = useState(initialPhone.replace(/^0+/, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const e164 = joinE164(country.dial, phone);
    if (!e164) return setError(`Enter a valid ${country.name} phone number.`);
    setBusy(true);
    setError(null);
    setNotOnPulse(null);
    try {
      const id = await api.findUserByPhone(e164);
      if (!id) {
        setNotOnPulse(e164);
        setBusy(false);
        return;
      }
      if (id === user?.id) {
        setError('That is your own number.');
        setBusy(false);
        return;
      }
      // you typed this number, so you can see it on this device (header, list, contact info)
      saveContact(id, { phone: e164 });
      onClose();
      if (onFound) onFound(id); else openChat(id);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="New chat" icon={MessageCirclePlus} onClose={onClose}>
      <form onSubmit={find} className="space-y-3" noValidate>
        <CountryPhoneInput country={country} onCountry={setIso} value={phone} onChange={setPhone} autoFocus />
        <p className={`text-xs ${mutedText}`}>Any local or international number. Only you see the number you type; it is saved on this device.</p>
        {error && <ErrorNote message={error} />}
        {notOnPulse && (
          <div className="rounded-xl px-3 py-3 bg-wa-lightSecondary dark:bg-wa-darkSecondary">
            <p className={`text-sm ${bodyText}`}><b>{formatPhone(notOnPulse)}</b> is not on Pulse yet.</p>
            <button type="button" className={`${ghostBtn} mt-2 w-full`}
              onClick={async () => {
                const r = await shareLink({ url: window.location.origin, title: 'Join me on Pulse', text: 'Chat with me on Pulse:' });
                if (r === 'copied') show('Invite link copied');
              }}>
              <Share2 className="w-4 h-4" />Invite to Pulse
            </button>
          </div>
        )}
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}Find and chat
        </button>
      </form>
    </Modal>
  );
}

const looksLikePhone = (q: string) => /^[+\d][\d\s\-().]{6,}$/.test(q.trim()) && q.replace(/\D/g, '').length >= 7;

/**
 * Desktop (WhatsApp Web): the chat list column, the open conversation, and a toggleable Contact info drawer.
 * The navigation rail is the app's LeftRail.
 */
function ChatsDesktop() {
  const { user } = useAuth();
  const { show } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [newChat, setNewChat] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [listKey, setListKey] = useState(0);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const open = useCallback((id: string) => {
    setSelected((cur) => {
      if (cur !== id) { setMeta(null); setSearch(null); }
      return id;
    });
  }, []);

  // the drawer's Favorites switch reflects the saved chat preference
  const conv = meta?.conversationId ?? null;
  useEffect(() => {
    if (!conv || !user) return;
    let alive = true;
    api.myConversationPrefs(user.id).then((rows) => { if (alive) setFavorite(!!rows.find((r) => r.conversation_id === conv)?.is_favorite); }).catch(() => undefined);
    return () => { alive = false; };
  }, [conv, user]);

  const setFav = async (on: boolean) => {
    if (!conv || !user) return;
    setFavorite(on);
    try {
      await api.setConversationPrefs(conv, user.id, { is_favorite: on });
      show(on ? 'Added to favorites' : 'Removed from favorites');
      setListKey((k) => k + 1);
    } catch (e) {
      setFavorite(!on);
      show(friendlyError(e), 'error');
    }
  };

  const iconBtn = `p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${mutedText}`;
  const menuItem = `w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary ${bodyText}`;

  return (
    <div className="flex flex-1 h-full min-h-0 overflow-hidden" data-testid="chats-desktop">
      {/* column 2: chat list */}
      <div className="flex flex-col w-[30%] min-w-[340px] max-w-[460px] flex-shrink-0 min-h-0 bg-wa-lightPanel dark:bg-wa-darkPanel border-r border-wa-lightBorder dark:border-wa-darkBorder">
        <header className="flex items-center gap-1 px-4 pt-3 pb-2">
          <h1 className={`flex-1 text-[22px] font-semibold ${bodyText}`}>Pulse</h1>
          <button type="button" onClick={() => setNewChat('')} aria-label="New chat" title="New chat" className={iconBtn}><MessageCirclePlus className="w-5 h-5" /></button>
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menu} title="Menu" className={iconBtn}>
              <EllipsisVertical className="w-5 h-5" />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-52 rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel shadow-xl py-1.5">
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(false); setNewChat(''); }}><MessageCirclePlus className="w-4 h-4" />New chat</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(false); setFilter('favorites'); }}><Star className="w-4 h-4" />Favorites</button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(false); setFilter('archived'); }}><Archive className="w-4 h-4" />Archived</button>
              </div>
            )}
          </div>
        </header>
        <div className="px-3 pb-1">
          <div className="relative">
            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or start a new chat" aria-label="Search or start a new chat"
              className={`${inputClass} pl-9 !rounded-lg !py-2 !bg-wa-lightSecondary dark:!bg-wa-darkSecondary !border-transparent`} />
          </div>
          {looksLikePhone(query) && (
            <button type="button" onClick={() => setNewChat(query)} className="mt-2 w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary">
              <MessageCirclePlus className="w-5 h-5 text-wa-green" /><span className={bodyText}>Start a new chat with <b>{query.trim()}</b></span>
            </button>
          )}
        </div>
        <ConversationList key={listKey} onOpen={open} query={looksLikePhone(query) ? '' : query} selectedId={selected} morePill filter={filter} onFilter={setFilter} />
      </div>

      {/* column 3: the conversation */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {selected ? (
          <ChatThread key={selected} otherUserId={selected} initialRef={null} embedded
            onBack={() => setSelected(null)} onClose={() => { setSelected(null); setInfo(false); }}
            onInfo={() => setInfo((v) => !v)} search={search} onSearch={setSearch} onMeta={setMeta} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-10 bg-wa-lightSecondary dark:bg-wa-dark">
            <BrandLogo size="lg" />
            <p className={`mt-6 text-2xl font-light ${bodyText}`}>Pulse for desktop</p>
            <p className={`mt-2 text-sm max-w-md ${mutedText}`}>Pick a chat on the left, or start a new one by phone number. Send messages, voice notes and snaps.</p>
            <p className={`mt-10 flex items-center gap-1.5 text-xs ${mutedText}`}><Lock className="w-3.5 h-3.5" />Your messages are private to each chat.</p>
          </div>
        )}
      </div>

      {/* column 4: contact info drawer */}
      {selected && info && (
        <div className="w-[30%] min-w-[340px] max-w-[440px] flex-shrink-0 min-h-0 animate-section-in">
          <ContactInfoDrawer otherUserId={selected} meta={meta} favorite={favorite} onFavorite={setFav}
            onSearch={() => setSearch((s) => s ?? '')} onClose={() => setInfo(false)}
            onDeleted={() => { setInfo(false); setSelected(null); setListKey((k) => k + 1); }} />
        </div>
      )}

      {newChat !== null && <NewChatByPhone initialPhone={newChat} onClose={() => setNewChat(null)} onFound={(id) => { setQuery(''); open(id); }} />}
    </div>
  );
}

/** WhatsApp-style Chats: search, filter pills (All / Unread / Favorites / Groups / Archived), new chat by phone. */
export default function ChatsTab() {
  const { user, openAuth } = useAuth();
  const desktop = useIsDesktop();
  const { openChat } = useSocial();
  const [query, setQuery] = useState('');
  const [newChat, setNewChat] = useState(false);

  if (!user) {
    return (
      <div className="flex flex-col h-full">
        <SectionHeader title="Chats" camera={false} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
          <MessageCircle className="w-14 h-14 text-wa-quiet mb-3" />
          <p className={`text-base font-medium ${bodyText}`}>Your chats live here</p>
          <p className={`text-sm mt-1 max-w-xs ${mutedText}`}>Sign in with your phone number to message people and send snaps.</p>
          <div className="flex gap-2 mt-5">
            <button onClick={() => openAuth('signin')} className={primaryBtn}><LogIn className="w-4 h-4" />Sign in</button>
            <button onClick={() => openAuth('signup')} className={ghostBtn}>Create account</button>
          </div>
        </div>
      </div>
    );
  }

  if (desktop) return <ChatsDesktop />;

  return (
    <div className="flex flex-col h-full min-h-0">
      <SectionHeader
        title="Chats"
        actions={
          <button onClick={() => setNewChat(true)} aria-label="New chat by phone number" title="New chat" className={headerIconBtn}>
            <MessageCirclePlus className="w-6 h-6" />
          </button>
        }
      />
      <div className="px-3">
        <div className="relative">
          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats"
            className={`${inputClass} pl-9 !rounded-full !py-2`} />
        </div>
      </div>
      <ConversationList onOpen={(id) => openChat(id)} query={query} />
      {newChat && <NewChatByPhone onClose={() => setNewChat(false)} />}
    </div>
  );
}
