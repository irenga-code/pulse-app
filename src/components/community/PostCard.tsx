import { useRef, useState } from 'react';
import { Flag, Trash2, ShieldX, Pencil, Loader2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import ReactionBurst from '@/components/reactions/ReactionBurst';
import type { Burst } from '@/components/reactions/bursts';
import PostMedia from '@/components/media/PostMedia';
import CommentsThread from '@/components/community/CommentsThread';
import ReportModal from '@/components/community/ReportModal';
import PostActions from '@/components/community/PostActions';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, inputClass, mutedText, bodyText } from '@/components/ui';
import { friendlyError } from '@/lib/api';
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
  /** Authors edit their post's text; rejects to keep the editor open. */
  onEdit?: (content: string) => Promise<void>;
  onAdminRemove: () => void;
  bursts: Burst[];
  onBurstDone: (id: number) => void;
  onCommentCount: (delta: number) => void;
  engagement?: PostEngagement;
};

export default function PostCard({ post, author, counts, mine, onReact, onDelete, onEdit, onAdminRemove, bursts, onBurstDone, onCommentCount, engagement }: Props) {
  const { user, isAdmin, requireAuth } = useAuth();
  const { openProfile } = useSocial();
  const { show } = useToast();
  const cardRef = useRef<HTMLElement>(null);
  useViewTracker(cardRef, post.id, !!user && post.user_id !== user.id);
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const own = !!user && post.user_id === user.id;
  // older posts published on behalf of a business (as_venue) keep their writer private: no profile link or badge
  const profileId = post.as_venue ? null : post.user_id;
  const liked = mine === 'heart';

  const saveEdit = async () => {
    if (draft === null || !onEdit) return;
    const text = draft.trim();
    if (text.length < 1 || text.length > 1000) return setEditError('Posts need 1-1000 characters.');
    setSaving(true);
    setEditError(null);
    try {
      await onEdit(text);
      setDraft(null);
      show('Post updated');
    } catch (e) {
      setEditError(friendlyError(e));
    }
    setSaving(false);
  };

  const share = async () => {
    const result = await shareLink({ url: postLink(post.id), title: `${post.user_name} on Pulse`, text: post.content.slice(0, 120) });
    if (result === 'copied') show('Link copied');
    else if (result === 'failed') show('Could not share. Copy the link from the address bar.', 'error');
  };

  return (
    <article ref={cardRef} className="relative bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-4 border border-wa-lightBorder dark:border-wa-darkBorder animate-slide-up">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => profileId && openProfile(profileId)} aria-label={`View ${post.user_name}'s profile`} className="flex-shrink-0 self-start" disabled={!profileId}>
          <Avatar name={post.user_name} url={post.as_venue ? null : author?.avatar_url} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
              <button type="button" onClick={() => profileId && openProfile(profileId)} disabled={!profileId} className={`font-semibold text-sm ${profileId ? 'hover:underline' : ''} ${bodyText}`}>{post.user_name}</button>
              {post.as_venue ? <RoleBadge official={post.is_official} /> : <RoleBadge accountType={author?.account_type} verified={author?.is_verified} official={post.is_official} />}
              <span className={`text-xs ${mutedText}`}>· {timeAgo(post.created_at)}</span>
            </div>
            <div className="flex items-center gap-0.5 -mt-1 -mr-1.5 flex-shrink-0">
              {confirming ? (
                <>
                  <button onClick={() => (own ? onDelete() : onAdminRemove())} className="text-xs font-semibold text-wa-live px-2 py-1">
                    {own ? 'Delete post?' : 'Remove post?'}
                  </button>
                  <button onClick={() => setConfirming(false)} className={`text-xs px-2 py-1 ${mutedText}`}>Cancel</button>
                </>
              ) : (
                <>
                  {own && onEdit && draft === null && (
                    <button onClick={() => setDraft(post.content ?? '')} aria-label="Edit post" className={`p-1.5 hover:text-wa-green ${mutedText}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
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
          {draft !== null ? (
            <div className="mt-1.5 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 1000))} rows={3} aria-label="Post text" className={`${inputClass} resize-none`} autoFocus />
              {editError && <ErrorNote message={editError} />}
              <div className="flex items-center gap-2">
                <button onClick={saveEdit} disabled={saving} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-wa-green rounded-lg px-3 py-1.5 disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save
                </button>
                <button onClick={() => { setDraft(null); setEditError(null); }} disabled={saving} className={`text-xs px-2 py-1.5 ${mutedText}`}>Cancel</button>
                <span className={`text-[11px] ml-auto ${mutedText}`}>{draft.length}/1000</span>
              </div>
            </div>
          ) : (
            post.content && <p className={`text-sm mt-1.5 leading-relaxed whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={post.content} /></p>
          )}
          {post.media_url && <PostMedia post={post} className="mt-2.5" onDoubleTap={() => { if (!liked) onReact('heart'); }} />}

          <PostActions
            replyCount={post.comments}
            repliesOpen={showComments}
            onReply={() => setShowComments((v) => !v)}
            reposted={engagement?.reposted ?? false}
            repostCount={engagement?.repostCount ?? post.reposts ?? 0}
            onRepost={engagement?.onRepost}
            liked={liked}
            likeCount={counts.heart ?? 0}
            onLike={() => onReact('heart')}
            viewCount={post.views ?? 0}
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
