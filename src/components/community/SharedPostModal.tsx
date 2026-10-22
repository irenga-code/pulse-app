import { Link2 } from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import PostMedia from '@/components/media/PostMedia';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { Spinner, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { timeAgo } from '@/lib/time';
import { useAsync } from '@/hooks/useAsync';
import { useSocial } from '@/context/SocialContext';

/** Opens when someone follows a shared post link (#/post/<id>). */
export default function SharedPostModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { openProfile } = useSocial();
  const data = useAsync(async () => {
    const post = await api.getPost(postId);
    const people = post?.user_id ? await api.profilesByIds([post.user_id]) : {};
    return { post, author: post?.user_id ? people[post.user_id] : undefined };
  }, [], `post:${postId}`);
  const post = data.data?.post;

  return (
    <Modal title="Shared post" icon={Link2} onClose={onClose}>
      {data.loading && !data.data ? (
        <Spinner />
      ) : !post ? (
        <p className={`text-sm text-center py-6 ${mutedText}`}>This post is no longer available. It may have been deleted, or it was a snap that has expired.</p>
      ) : (
        <article className="space-y-2.5">
          <div className="flex items-center gap-3">
            <button onClick={() => post.user_id && !post.as_venue && openProfile(post.user_id)} disabled={post.as_venue} aria-label={`View ${post.user_name}'s profile`}><Avatar name={post.user_name} url={post.as_venue ? null : data.data?.author?.avatar_url} /></button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`font-semibold text-sm ${bodyText}`}>{post.user_name}</span>
                {post.as_venue
                  ? <RoleBadge official={post.is_official} />
                  : <RoleBadge accountType={data.data?.author?.account_type} verified={data.data?.author?.is_verified} official={post.is_official} />}
              </div>
              <span className={`text-xs ${mutedText}`}>{timeAgo(post.created_at)}{post.venue_name && !post.as_venue ? ` · ${post.venue_name}` : ''}</span>
            </div>
          </div>
          {post.content && <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={post.content} /></p>}
          {post.media_url && <PostMedia post={post} />}
          <p className={`text-xs ${mutedText}`}>{post.comments} comments · {post.views ?? 0} views</p>
        </article>
      )}
    </Modal>
  );
}
