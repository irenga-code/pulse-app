import { memo, useState } from 'react';
import { splitEmoji, twemojiUrl } from '@/components/emoji/emojiLibrary';
import { parse } from 'twemoji-parser';

/**
 * One emoji drawn as a Twemoji picture, so it looks the same on every device.
 * If the picture can not load (offline, or an emoji newer than Twemoji) it falls back to the device's own emoji.
 */
export const EmojiImg = memo(function EmojiImg({ emoji, url, className = '' }: { emoji: string; url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = url ?? parse(emoji, { buildUrl: twemojiUrl })[0]?.url;
  if (failed || !src) return <span className={className} role="img" aria-label={emoji}>{emoji}</span>;
  return (
    <img
      src={src}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`inline-block w-[1.25em] h-[1.25em] align-[-0.25em] select-none ${className}`}
    />
  );
});

/** Text where every emoji is drawn with Twemoji (posts, comments, chat messages). Keeps the text itself selectable/copyable via alt. */
export const EmojiText = memo(function EmojiText({ text }: { text: string }) {
  const parts = splitEmoji(text);
  if (parts.length === 1 && parts[0].type === 'text') return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : <EmojiImg key={i} emoji={p.text} url={p.url} />))}
    </>
  );
});
