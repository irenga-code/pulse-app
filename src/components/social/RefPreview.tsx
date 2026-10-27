import { Image as ImageIcon, MessageSquareQuote, Clock } from 'lucide-react';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/apiClient';
import type { MessageRefType } from '@/lib/types';

type Preview = { thumb: string | null; isVideo: boolean; title: string; text: string } | null;

async function loadPreview(type: MessageRefType, id: string): Promise<Preview> {
  if (type === 'post') {
    const p = await api.getPost(id);
    if (!p) return null;
    return { thumb: p.media_type === 'image' ? p.media_url : null, isVideo: p.media_type === 'video', title: `Post by ${p.user_name}`, text: p.content };
  }
  const s = await api.getStatus(id);
  if (!s) return null;
  return { thumb: s.media_type === 'image' ? s.media_url : null, isVideo: s.media_type === 'video', title: 'Status', text: s.caption ?? '' };
}

/** Small card showing the post or status a message is about. */
export default function RefPreview({ type, id, onRemove, tone = 'light' }: { type: MessageRefType; id: string; onRemove?: () => void; tone?: 'light' | 'bubble' }) {
  const { data, loading } = useAsync(() => loadPreview(type, id), [], `mem:ref:${type}:${id}`);
  const box = tone === 'bubble' ? 'bg-black/10 dark:bg-white/10' : 'bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder';
  return (
    <div className={`flex items-center gap-2.5 rounded-xl p-2 ${box}`} data-testid="ref-preview">
      <span className="w-11 h-11 rounded-lg overflow-hidden bg-black/20 flex items-center justify-center flex-shrink-0">
        {data?.thumb ? <img src={data.thumb} alt="" className="w-full h-full object-cover" /> : data?.isVideo ? <ImageIcon className="w-5 h-5 opacity-70" /> : type === 'status' ? <Clock className="w-5 h-5 opacity-70" /> : <MessageSquareQuote className="w-5 h-5 opacity-70" />}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-medium opacity-80 truncate">{loading ? 'Loading…' : data ? data.title : type === 'status' ? 'Status expired' : 'Post no longer available'}</span>
        {data?.text && <span className="block text-xs truncate opacity-90"><EmojiText text={data.text} /></span>}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove attachment" className="p-1 text-xs opacity-70 hover:opacity-100">✕</button>
      )}
    </div>
  );
}
