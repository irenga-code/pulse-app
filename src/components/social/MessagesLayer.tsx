import InboxView from '@/components/social/InboxView';
import ChatShell from '@/components/social/ChatShell';
import ChatThread from '@/components/social/ChatThread';
import type { ChatTarget } from '@/context/SocialContext';

/** The messages overlay: the inbox list, or one private conversation. */
export default function MessagesLayer({ target, onNavigate, onClose }: { target: ChatTarget; onNavigate: (t: ChatTarget) => void; onClose: () => void }) {
  if (target.view === 'inbox') {
    return (
      <ChatShell label="Messages" onClose={onClose}>
        <InboxView onOpen={(id) => onNavigate({ view: 'thread', otherUserId: id, ref: null })} onClose={onClose} />
      </ChatShell>
    );
  }
  // key: switching to another person starts a fresh thread
  return <ChatThread key={target.otherUserId} otherUserId={target.otherUserId} initialRef={target.ref} onBack={() => onNavigate({ view: 'inbox' })} onClose={onClose} />;
}
