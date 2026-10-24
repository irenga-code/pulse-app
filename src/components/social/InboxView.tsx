import { X, MessageCircle } from 'lucide-react';
import ConversationList from '@/components/social/ConversationList';
import { mutedText, bodyText } from '@/components/ui';

/** The Messages overlay's list (Profile > Messages, notifications): the same filtered chat list as the Chats screen. */
export default function InboxView({ onOpen, onClose }: { onOpen: (otherUserId: string) => void; onClose: () => void }) {
  return (
    <>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
        <MessageCircle className="w-5 h-5 text-wa-green" />
        <h2 className={`flex-1 text-base font-bold ${bodyText}`}>Messages</h2>
        <button onClick={onClose} aria-label="Close messages" className={`p-1.5 rounded-full ${mutedText} hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary`}><X className="w-5 h-5" /></button>
      </header>
      <ConversationList onOpen={onOpen} />
    </>
  );
}
