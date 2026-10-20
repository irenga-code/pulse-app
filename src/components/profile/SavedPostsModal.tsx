import { Bookmark } from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { Spinner, ErrorNote, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Post } from '@/lib/types';
import { userKey } from '@/lib/cache';

/** Posts the signed-in user bookmarked from the feed. */
export default function SavedPostsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const data = useAsync(() => (user ? api.listSavedPosts(user.id) : Promise.resolve([] as Post[])), [], user ? userKey(user.id, 'saved-posts') : null);

  const remove = async (id: string) => {
    if (!user) return;
    try {
      await api.unsavePost(user.id, id);
      data.setData((data.data ?? []).filter((p) => p.id !== id));
    } catch (e) {
      show(friendlyError(e), 'error');
    }
  };

  return (
    <Modal title="Saved posts" icon={Bookmark} onClose={onClose}>
      {data.loading && !data.data ? (
        <Spinner />
      ) : data.error ? (
        <ErrorNote message={data.error} />
      ) : (data.data ?? []).length === 0 ? (
        <p className={`text-sm text-center py-8 ${mutedText}`}>Nothing saved yet. Tap the bookmark under a post to keep it here.</p>
      ) : (
        <ul className="space-y-3">
          {data.data!.map((p) => (
            <li key={p.id} className="rounded-xl p-3 bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder">
              <div className="flex items-center gap-2">
                <Avatar name={p.user_name} size={28} />
                <span className={`text-sm font-semibold ${bodyText}`}>{p.user_name}</span>
                <span className={`text-xs ${mutedText}`}>· {timeAgo(p.created_at)}</span>
                <button onClick={() => remove(p.id)} aria-label="Remove from saved" className="ml-auto text-xs font-semibold text-wa-green">Remove</button>
              </div>
              {p.content && <p className={`text-sm mt-2 whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={p.content} /></p>}
              {p.media_url && (p.media_type === 'video'
                ? <video src={p.media_url} controls playsInline muted className="mt-2 rounded-lg w-full max-h-64 bg-black" />
                : <img src={p.media_url} alt="" loading="lazy" className="mt-2 rounded-lg w-full max-h-64 object-cover" />)}
              <a href={`#/post/${p.id}`} onClick={onClose} className="inline-block mt-2 text-xs font-semibold text-wa-green">Open post</a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
