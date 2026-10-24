import { useState } from 'react';
import { Search, MessageCirclePlus, Smartphone, Loader2, LogIn, MessageCircle } from 'lucide-react';
import Modal from '@/components/Modal';
import SectionHeader, { headerIconBtn } from '@/components/nav/SectionHeader';
import ConversationList from '@/components/social/ConversationList';
import { ErrorNote, Field, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useSocial } from '@/context/SocialContext';

/** Start a chat with whoever has confirmed this number on Pulse (the number is matched, never shown). */
function NewChatByPhone({ onClose }: { onClose: () => void }) {
  const { openChat } = useSocial();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return setError('Enter the full number with country code, e.g. +256 700 000 000.');
    setBusy(true);
    setError(null);
    try {
      const id = await api.findUserByPhone(phone);
      if (!id) {
        setError('No one on Pulse has confirmed that number yet.');
        setBusy(false);
        return;
      }
      onClose();
      openChat(id);
    } catch (err) {
      setError(isMissingSchema(err) ? 'Chat by phone number needs the latest database update (migration 15).' : friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="New chat" icon={MessageCirclePlus} onClose={onClose}>
      <form onSubmit={find} className="space-y-3" noValidate>
        <Field label="Phone number">
          <div className="relative">
            <Smartphone className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+256 700 000 000"
              aria-label="Phone number" className={`${inputClass} pl-9`} autoFocus />
          </div>
        </Field>
        <p className={`text-xs ${mutedText}`}>Pulse only finds people who confirmed their number. Their number is never shown to you.</p>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}Find and chat
        </button>
      </form>
    </Modal>
  );
}

/** WhatsApp-style Chats: search, filter pills (All / Unread / Favorites / Groups / Archived), new chat by phone. */
export default function ChatsTab() {
  const { user, openAuth } = useAuth();
  const { openChat } = useSocial();
  const [query, setQuery] = useState('');
  const [newChat, setNewChat] = useState(false);

  if (!user) {
    return (
      <div className="flex flex-col h-full">
        <SectionHeader title="Chats" camera={false} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
          <MessageCircle className="w-14 h-14 text-wa-quiet mb-3" />
          <p className={`text-base font-semibold ${bodyText}`}>Your chats live here</p>
          <p className={`text-sm mt-1 max-w-xs ${mutedText}`}>Sign in with your phone number or email to message people and venues, and send snaps.</p>
          <div className="flex gap-2 mt-5">
            <button onClick={() => openAuth('signin')} className={primaryBtn}><LogIn className="w-4 h-4" />Sign in</button>
            <button onClick={() => openAuth('signup')} className={ghostBtn}>Create account</button>
          </div>
        </div>
      </div>
    );
  }

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
