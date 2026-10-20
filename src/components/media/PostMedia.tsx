import { useRef, useState } from 'react';
import { Clock, Heart } from 'lucide-react';
import { timeLeft } from '@/lib/time';
import type { Post } from '@/lib/types';

type Pop = { id: number; x: number; y: number; tilt: number };

/**
 * Photo or video attached to a post/snap. The camera burns filters, stickers and stamps into the file.
 * With `onDoubleTap`, double-tapping (or double-clicking) the media likes the post and pops a heart where you tapped.
 */
export default function PostMedia({ post, className = '', onDoubleTap }: {
  post: Pick<Post, 'media_url' | 'media_type' | 'media_width' | 'media_height' | 'expires_at' | 'kind'>;
  className?: string;
  onDoubleTap?: () => void;
}) {
  const [pops, setPops] = useState<Pop[]>([]);
  const lastTap = useRef(0);
  if (!post.media_url) return null;
  const ratio = post.media_width && post.media_height ? `${post.media_width} / ${post.media_height}` : '9 / 16';
  const left = post.kind === 'snap' ? timeLeft(post.expires_at) : null;

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current > 320) { lastTap.current = now; return; }
    lastTap.current = 0;
    const r = e.currentTarget.getBoundingClientRect();
    const pop: Pop = { id: now, x: r.width ? e.clientX - r.left : r.width / 2, y: r.height ? e.clientY - r.top : r.height / 2, tilt: Math.round(Math.random() * 30 - 15) };
    setPops((p) => [...p, pop]);
    window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 900);
    onDoubleTap();
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-black ${className}`}
      style={{ aspectRatio: ratio, maxHeight: '70vh', touchAction: onDoubleTap ? 'manipulation' : undefined }}
      onClick={tap}
      data-testid="post-media"
    >
      {post.media_type === 'video' ? (
        <video src={post.media_url} controls playsInline muted loop preload="metadata" className="w-full h-full object-contain" />
      ) : (
        <img src={post.media_url} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover select-none" />
      )}
      {left && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-black/55 text-white backdrop-blur-sm">
          <Clock className="w-3 h-3" />{left}
        </span>
      )}
      {pops.map((p) => (
        <Heart
          key={p.id}
          aria-hidden="true"
          data-testid="heart-pop"
          className="heart-pop absolute w-24 h-24 -ml-12 -mt-12 pointer-events-none fill-pink-500 text-pink-500 drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
          style={{ left: p.x, top: p.y, ['--tilt' as string]: `${p.tilt}deg` }}
        />
      ))}
    </div>
  );
}
