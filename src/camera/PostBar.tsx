import { useRef } from 'react';
import { MapPin, Send, Loader2, RotateCcw } from 'lucide-react';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { insertAtCaret } from '@/components/emoji/emojiData';
import { MAX_CAPTION } from '@/camera/constants';
import type { PublishState } from '@/camera/useSnapPublisher';

/** One-tap publishing: caption, venue tag and the Post button live together under the snap. */
export default function PostBar({ caption, onCaption, venueLabel, onPickVenue, onPost, state, error }: {
  caption: string; onCaption: (v: string) => void; venueLabel: string | null; onPickVenue: () => void; onPost: () => void;
  state: PublishState; error: string | null;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const busy = state === 'uploading' || state === 'saving';
  return (
    <div className="absolute left-0 right-0 bottom-0 z-20 p-3 pb-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent text-white">
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-red-500/20 border border-red-400/40 px-3 py-1.5 text-xs">{error}</p>
      )}
      <div className="flex items-center gap-2 rounded-2xl bg-white/15 backdrop-blur-sm pl-3 pr-1">
        <input
          ref={ref}
          value={caption}
          onChange={(e) => onCaption(e.target.value.slice(0, MAX_CAPTION))}
          placeholder="Add a caption…"
          aria-label="Caption"
          className="flex-1 bg-transparent py-3 text-sm placeholder:text-white/60 focus:outline-none"
        />
        <EmojiButton
          label="Add emoji to caption"
          onPick={(e) => {
            const { value, caret } = insertAtCaret(ref.current, caption, e, MAX_CAPTION);
            onCaption(value);
            requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(caret, caret); });
          }}
        />
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button onClick={onPickVenue} aria-label="Tag a venue" className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2.5 text-sm font-medium max-w-[55%]">
          <MapPin className="w-4 h-4 text-wa-green flex-shrink-0" />
          <span className="truncate">{venueLabel ?? 'Tag a venue'}</span>
        </button>
        <button
          onClick={onPost}
          disabled={busy}
          data-testid="post-snap"
          className="ml-auto flex items-center gap-2 rounded-full bg-wa-green px-6 py-2.5 text-sm font-bold disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : state === 'error' ? <RotateCcw className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          {state === 'uploading' ? 'Uploading…' : state === 'saving' ? 'Posting…' : state === 'error' ? 'Retry' : 'Post to Pulse'}
        </button>
      </div>
    </div>
  );
}
