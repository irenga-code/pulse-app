import { MessageCircle, ThumbsUp, Bookmark, Share } from 'lucide-react';
import { formatCount } from '@/lib/format';
import { mutedText } from '@/components/ui';

export type PostActionsProps = {
  commentCount: number;
  commentsOpen: boolean;
  onToggleComments: () => void;
  liked: boolean;
  likeCount: number;
  onLike: () => void;
  saved: boolean;
  onSave: () => void;
  onShare: () => void;
};

// 40px tall tap targets; the row never wraps, so it stays one line on the narrowest phones
const base = 'flex items-center justify-center gap-1.5 min-h-10 min-w-10 px-2.5 text-xs rounded-full transition-colors active:scale-95';

/** Engagement row: comments and likes on the left, bookmark and share on the right. */
export default function PostActions(p: PostActionsProps) {
  return (
    <div className="flex items-center -ml-2.5 -mr-2.5 mt-1.5" role="group" aria-label="Post actions">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={p.onToggleComments}
          aria-expanded={p.commentsOpen}
          aria-label={`Comments, ${p.commentCount}`}
          className={`${base} ${p.commentsOpen ? 'text-wa-green' : mutedText} hover:text-wa-green hover:bg-wa-green/10`}
        >
          <MessageCircle className="w-[18px] h-[18px]" />
          <span>{formatCount(p.commentCount)}</span>
        </button>

        <button
          type="button"
          onClick={p.onLike}
          aria-pressed={p.liked}
          aria-label={`${p.liked ? 'Unlike' : 'Like'}, ${p.likeCount}`}
          className={`${base} ${p.liked ? 'text-wa-green font-semibold' : mutedText} hover:text-wa-green hover:bg-wa-green/10`}
        >
          <ThumbsUp className={`w-[18px] h-[18px] ${p.liked ? 'fill-wa-green' : ''}`} />
          <span>{formatCount(p.likeCount)}</span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={p.onSave}
          aria-pressed={p.saved}
          aria-label={p.saved ? 'Remove bookmark' : 'Bookmark'}
          className={`${base} ${p.saved ? 'text-wa-green' : mutedText} hover:text-wa-green hover:bg-wa-green/10`}
        >
          <Bookmark className={`w-[18px] h-[18px] ${p.saved ? 'fill-wa-green' : ''}`} />
        </button>
        <button type="button" onClick={p.onShare} aria-label="Share" className={`${base} ${mutedText} hover:text-wa-green hover:bg-wa-green/10`}>
          <Share className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
