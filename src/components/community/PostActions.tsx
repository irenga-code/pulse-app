import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Repeat2, Heart, BarChart2, Bookmark, Share, Quote, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { formatCount } from '@/lib/format';
import { inputClass, primaryBtn, mutedText } from '@/components/ui';

export type PostActionsProps = {
  replyCount: number;
  repliesOpen: boolean;
  onReply: () => void;
  reposted: boolean;
  repostCount: number;
  /** Undefined hides the repost menu (no engagement state for this post). */
  onRepost?: (quote?: string) => void;
  liked: boolean;
  likeCount: number;
  onLike: () => void;
  viewCount: number;
  saved: boolean;
  onSave: () => void;
  onShare: () => void;
};

const QUOTE_MAX = 280;

// 40px tall tap targets; the row never wraps, so it stays one line on the narrowest phones
const base = 'group flex items-center gap-1 min-h-10 min-w-10 px-2 text-xs rounded-full transition-colors active:scale-95 tabular-nums';
const iconBase = 'w-[18px] h-[18px] flex-shrink-0';

/** X-style engagement row: reply, repost, like and views spread out on the left, bookmark and share on the right. */
export default function PostActions(p: PostActionsProps) {
  const [menu, setMenu] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);

  const menuItem = 'flex w-full items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary';

  return (
    <div className="flex items-center -ml-2 -mr-2 mt-1.5" role="group" aria-label="Post actions">
      <div className="flex flex-1 min-w-0 items-center justify-between pr-2">
        <button
          type="button"
          onClick={p.onReply}
          aria-expanded={p.repliesOpen}
          aria-label={`Replies, ${p.replyCount}`}
          className={`${base} ${p.repliesOpen ? 'text-sky-500' : mutedText} hover:text-sky-500 hover:bg-sky-500/10`}
        >
          <MessageCircle className={iconBase} />
          <span>{formatCount(p.replyCount)}</span>
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            disabled={!p.onRepost}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-pressed={p.reposted}
            aria-label={`${p.reposted ? 'Undo repost' : 'Repost'}, ${p.repostCount}`}
            className={`${base} ${p.reposted ? 'text-emerald-500 font-semibold' : mutedText} hover:text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40`}
          >
            <Repeat2 className={iconBase} />
            <span>{formatCount(p.repostCount)}</span>
          </button>
          {menu && p.onRepost && (
            <div role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-40 overflow-hidden rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel text-wa-lightText dark:text-wa-darkText shadow-lg">
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(false); p.onRepost?.(); }}>
                <Repeat2 className="w-4 h-4" />{p.reposted ? 'Undo repost' : 'Repost'}
              </button>
              {!p.reposted && (
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(false); setQuoting(true); }}>
                  <Quote className="w-4 h-4" />Quote
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={p.onLike}
          aria-pressed={p.liked}
          aria-label={`${p.liked ? 'Unlike' : 'Like'}, ${p.likeCount}`}
          className={`${base} ${p.liked ? 'text-pink-600 font-semibold' : mutedText} hover:text-pink-600 hover:bg-pink-600/10`}
        >
          <Heart className={`${iconBase} ${p.liked ? 'fill-pink-600' : ''}`} />
          <span>{formatCount(p.likeCount)}</span>
        </button>

        {/* read-only, like X's view count: views are counted when the post has been on screen for a second */}
        <span role="img" aria-label={`${p.viewCount} view${p.viewCount === 1 ? '' : 's'}`} title={`${p.viewCount.toLocaleString()} views`}
          className={`${base} ${mutedText} active:scale-100`}>
          <BarChart2 className={iconBase} />
          <span>{formatCount(p.viewCount)}</span>
        </span>
      </div>

      <div className="flex items-center">
        <button
          type="button"
          onClick={p.onSave}
          aria-pressed={p.saved}
          aria-label={p.saved ? 'Remove bookmark' : 'Bookmark'}
          className={`${base} justify-center ${p.saved ? 'text-sky-500' : mutedText} hover:text-sky-500 hover:bg-sky-500/10`}
        >
          <Bookmark className={`${iconBase} ${p.saved ? 'fill-sky-500' : ''}`} />
        </button>
        <button type="button" onClick={p.onShare} aria-label="Share" className={`${base} justify-center ${mutedText} hover:text-sky-500 hover:bg-sky-500/10`}>
          <Share className={iconBase} />
        </button>
      </div>

      {quoting && p.onRepost && <QuoteModal onClose={() => setQuoting(false)} onSubmit={(q) => { setQuoting(false); p.onRepost?.(q); }} />}
    </div>
  );
}

function QuoteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (quote: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Quote" icon={Quote} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); onSubmit(text.trim()); }} className="space-y-3">
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, QUOTE_MAX))} rows={3} autoFocus
          placeholder="Add a comment" aria-label="Quote text" className={`${inputClass} resize-none`} />
        <div className="flex items-center gap-2">
          <span className={`text-[11px] ${mutedText}`}>{text.length}/{QUOTE_MAX}</span>
          <button type="submit" disabled={busy || !text.trim()} className={`${primaryBtn} ml-auto`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat2 className="w-4 h-4" />}Post
          </button>
        </div>
      </form>
    </Modal>
  );
}
