import { useRef, useState } from 'react';
import { Flag, Trash2, ShieldX, MapPin } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import ReactionBar from '@/components/reactions/ReactionBar';
import ReactionBurst from '@/components/reactions/ReactionBurst';
import type { Burst } from '@/components/reactions/bursts';
import PostMedia from '@/components/media/PostMedia';
import CommentsThread from '@/components/community/CommentsThread';
import ReportModal from '@/components/community/ReportModal';
import PostActions from '@/components/community/PostActions';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { mutedText, bodyText } from '@/components/ui';
import { timeAgo } from '@/lib/time';
import { useAuth } from '@/context/AuthContext';
import { useSocial } from '@/context/SocialContext';
import { useViewTracker } from '@/hooks/useViewTracker';
import { postLink, shareLink } from '@/lib/share';
import { useToast } from '@/context/ToastContext';
import type { Post, PublicProfile, ReactionCounts, ReactionKind } from '@/lib/types';

/** Per-user engagement state the feed hands to each card (bookmark, repost, extra counters). */
export type PostEngagement = {
  reposted: boolean;
  repostCount: number;
  onRepost: (quote?: string) => void;
  saved: boolean;
  onSave: () => void;
};

type Props = {
  post: Post;
  author?: PublicProfile;
  counts: ReactionCounts;
  mine: ReactionKind | null;
  onReact: (kind: ReactionKind) => void;
  onDelete: () => void;
  onAdminRemove: () => void;
  bursts: Burst[];
  onBurstDone: (id: number) => void;
  onCommentCount: (delta: number) => void;
  engagement?: PostEngagement;
};

export default function PostCard({ post, author, counts, mine, onReact, onDelete, onAdminRemove, bursts, onBurstDone, onCommentCount, engagement }: Props) {
  const { user, isAdmin, requireAuth } = useAuth();
  const { openProfile } = useSocial();
  const { show } = useToast();
  const cardRef = useRef<HTMLElement>(null);
  useViewTracker(cardRef, post.id, !!user && post.user_id !== user.id);
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const own = !!user && post.user_id === user.id;
  const liked = mine === 'heart';

  const share = async () => {
    const result = await shareLink({ url: postLink(post.id), title: `${post.user_name} on Pulse`, text: post.content.slice(0, 120) });
    if (result === 'copied') show('Link copied');
    else if (result === 'failed') show('Could not share. Copy the link from the address bar.', 'error');
  };

  return (
    <article ref={cardRef} className="relative bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-4 border border-wa-lightBorder dark:border-wa-darkBorder animate-slide-up">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => post.user_id && openProfile(post.user_id)} aria-label={`View ${post.user_name}'s profile`} className="flex-shrink-0 self-start" disabled={!post.user_id}>
          <Avatar name={post.user_name} url={author?.avatar_url} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => post.user_id && openProfile(post.user_id)} disabled={!post.user_id} className={`font-semibold text-sm hover:underline ${bodyText}`}>{post.user_name}</button>
            <RoleBadge accountType={author?.account_type} verified={author?.is_verified} official={post.is_official} />
            <span className={`text-xs ${mutedText}`}>· {timeAgo(post.created_at)}</span>
          </div>
          {post.venue_name && (
            <span className="inline-flex items-center gap-1 text-xs text-wa-green font-medium mt-0.5">
              <MapPin className="w-3 h-3" />
              {post.venue_name}
            </span>
          )}
          {post.content && <p className={`text-sm mt-1.5 leading-relaxed whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={post.content} /></p>}
          {post.media_url && <PostMedia post={post} className="mt-2.5" onDoubleTap={() => { if (!liked) onReact('heart'); }} />}

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <ReactionBar counts={counts} mine={mine} onReact={onReact} exclude={['heart']} />
            <div className="ml-auto flex items-center gap-1">
              {confirming ? (
                <>
                  <button onClick={() => (own ? onDelete() : onAdminRemove())} className="text-xs font-semibold text-wa-live px-2 py-1">
                    {own ? 'Delete post?' : 'Remove post?'}
                  </button>
                  <button onClick={() => setConfirming(false)} className={`text-xs px-2 py-1 ${mutedText}`}>Cancel</button>
                </>
              ) : (
                <>
                  {own && (
                    <button onClick={() => setConfirming(true)} aria-label="Delete post" className={`p-1.5 hover:text-wa-live ${mutedText}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {isAdmin && !own && (
                    <button onClick={() => setConfirming(true)} aria-label="Remove post (moderator)" className={`p-1.5 hover:text-wa-live ${mutedText}`}>
                      <ShieldX className="w-4 h-4" />
                    </button>
                  )}
                  {!own && (
                    <button
                      onClick={() => (requireAuth('Sign in to report content.') ? setReporting(true) : undefined)}
                      aria-label="Report post"
                      className={`p-1.5 hover:text-wa-live ${mutedText}`}
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <PostActions
            commentCount={post.comments}
            commentsOpen={showComments}
            onToggleComments={() => setShowComments((v) => !v)}
            liked={liked}
            likeCount={counts.heart ?? 0}
            onLike={() => onReact('heart')}
            saved={engagement?.saved ?? false}
            onSave={() => (engagement ? engagement.onSave() : undefined)}
            onShare={share}
          />

          {showComments && <CommentsThread postId={post.id} onCountChange={onCommentCount} />}
        </div>
      </div>
      <ReactionBurst items={bursts} onDone={onBurstDone} />
      {reporting && <ReportModal targetType="post" targetId={post.id} onClose={() => setReporting(false)} />}
    </article>
  );
}
