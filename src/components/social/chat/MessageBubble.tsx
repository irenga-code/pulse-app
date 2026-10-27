import { useRef, useState } from 'react';
import { ChevronDown, Ghost, SmilePlus, Star, Forward, Pin } from 'lucide-react';
import RefPreview from '@/components/social/RefPreview';
import VoiceNote from '@/components/social/VoiceNote';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { QuickReactions, MessageMenu, type MessageAction } from '@/components/social/chat/MessageActions';
import type { ReactionSummary } from '@/hooks/useMessageExtras';
import type { ChatMessage } from '@/lib/types';

const PLACEHOLDER = /^(📸|🎥) Snap$|^🎤 Voice message$/u;
const LONG_PRESS_MS = 450;

/** The text a person would copy / quote: empty for a snap or voice note without a caption. */
export const messageText = (m: ChatMessage) => (m.media_url && PLACEHOLDER.test(m.body) ? '' : m.body);
/** Short preview for a reply quote or the pinned banner. */
export const messagePreview = (m: ChatMessage) =>
  messageText(m) || (m.media_type === 'audio' ? '🎤 Voice message' : m.media_type === 'video' ? '🎥 Video' : m.media_type === 'image' ? '📸 Photo' : m.body);

/**
 * One chat bubble with WhatsApp's message actions: hover (or long-press / right-click) shows the quick reaction bar
 * and the ⌄ menu; reactions, star, reply quote and "Forwarded" are drawn on the bubble.
 */
export default function MessageBubble({ m, mine, statusLine, replyTo, replyName, reactions, myReaction, starred, pinned, highlighted, onReact, onAction, onJump }: {
  m: ChatMessage; mine: boolean; statusLine: React.ReactNode;
  replyTo?: ChatMessage; replyName?: string;
  reactions?: ReactionSummary; myReaction: string | null; starred: boolean; pinned: boolean; highlighted: boolean;
  onReact: (emoji: string) => void; onAction: (a: MessageAction) => void; onJump: (id: string) => void;
}) {
  const [bar, setBar] = useState(false);
  const [menu, setMenu] = useState(false);
  const press = useRef<number | undefined>(undefined);
  const text = messageText(m);
  const align = mine ? 'right' : 'left';

  const startPress = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    press.current = window.setTimeout(() => { setBar(true); setMenu(true); navigator.vibrate?.(10); }, LONG_PRESS_MS);
  };
  const endPress = () => window.clearTimeout(press.current);

  // sent bubbles are a soft tint of the accent (index.css .bubble-out), not the bright brand colour
  const bubble = mine
    ? m.vanish ? 'bg-purple-600 text-white rounded-br-md' : 'bubble-out rounded-br-md'
    : m.vanish ? 'bg-zinc-800 text-zinc-100 rounded-bl-md' : 'bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightText dark:text-wa-darkText rounded-bl-md';
  // white-on-colour details only on the strong secret-mode bubbles; soft bubbles use the normal (readable) styling
  const onColor = m.vanish;

  return (
    <div id={`msg-${m.id}`} className={`group flex items-center gap-1 ${mine ? 'justify-end' : 'justify-start'} ${reactions?.length ? 'mb-3' : ''}`}>
      {/* the smiley sits beside the bubble on hover, like WhatsApp Web */}
      {mine && (
        <button type="button" onClick={() => setBar((v) => !v)} aria-label="React to message"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-black/5 dark:hover:bg-white/10 transition-opacity">
          <SmilePlus className="w-4 h-4" />
        </button>
      )}
      <div
        data-testid="chat-bubble"
        onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={endPress}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
        className={`relative max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug shadow-sm transition-[box-shadow] ${bubble} ${highlighted ? 'ring-4 ring-wa-green/40' : ''}`}
      >
        <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Message options" aria-haspopup="menu" aria-expanded={menu}
          className={`absolute top-1 right-1 z-10 p-0.5 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${onColor ? 'bg-black/20 text-white' : 'bg-wa-lightPanel/90 dark:bg-wa-darkSecondary/90 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'}`}>
          <ChevronDown className="w-4 h-4" />
        </button>
        {bar && <QuickReactions current={myReaction} onPick={onReact} onClose={() => setBar(false)} align={align} />}
        {menu && (
          <MessageMenu mine={mine} hasText={!!text} canForward={m.media_type !== 'audio'} pinned={pinned} starred={starred} align={align}
            onClose={() => setMenu(false)} onAction={(a) => (a === 'react' ? setBar(true) : onAction(a))} />
        )}

        {m.is_forwarded && <p className="flex items-center gap-1 text-[11px] italic opacity-75 mb-0.5"><Forward className="w-3 h-3" />Forwarded</p>}
        {m.reply_to_id && (
          <button type="button" onClick={() => replyTo && onJump(replyTo.id)} disabled={!replyTo} data-testid="reply-quote"
            className={`block w-full text-left mb-1.5 rounded-lg overflow-hidden ${onColor ? 'bg-black/15' : mine ? 'bubble-quote' : 'bg-black/5 dark:bg-white/5'}`}>
            <span className="flex">
              <span className={`w-1 flex-shrink-0 ${onColor ? 'bg-white/70' : 'bg-wa-green dark:bg-wa-greenLight'}`} />
              <span className="px-2 py-1 min-w-0">
                <span className={`block text-xs font-semibold ${onColor ? '' : 'text-wa-green dark:text-wa-greenLight'}`}>{replyTo ? replyName : 'Message'}</span>
                <span className="block text-xs truncate opacity-80">{replyTo ? messagePreview(replyTo) : 'This message is no longer available'}</span>
              </span>
            </span>
          </button>
        )}
        {m.ref_type && m.ref_id && <div className="mb-1.5"><RefPreview type={m.ref_type} id={m.ref_id} tone="bubble" /></div>}
        {m.media_url && m.media_type === 'audio' ? (
          <VoiceNote id={m.id} url={m.media_url} durationMs={m.media_duration_ms} waveform={m.media_waveform} mine={mine} tone={m.vanish ? 'secret' : 'normal'} />
        ) : m.media_url && (
          m.media_type === 'video'
            ? <video src={m.media_url} controls playsInline preload="metadata" aria-label="Video snap" className="-mx-1 mb-1 w-56 max-w-full aspect-[9/16] rounded-xl bg-black object-cover" />
            : <img src={m.media_url} alt="Photo snap" loading="lazy" className="-mx-1 mb-1 w-56 max-w-full aspect-[9/16] rounded-xl bg-black object-cover" />
        )}
        {/* a snap or voice note without a caption carries a placeholder body; the media says it already */}
        {text && <p className="whitespace-pre-wrap break-words pr-4"><EmojiText text={text} /></p>}
        <p className="mt-0.5 text-[10px] opacity-75 text-right flex items-center justify-end gap-1">
          {pinned && <Pin className="w-3 h-3" aria-label="Pinned" />}
          {starred && <Star className="w-3 h-3 fill-current" aria-label="Starred" />}
          {m.vanish && <Ghost className="w-3 h-3" />}
          {statusLine}
        </p>

        {!!reactions?.length && (
          <div className={`absolute -bottom-3.5 ${mine ? 'right-2' : 'left-2'} flex items-center gap-1`} data-testid="message-reactions">
            {reactions.map((r) => (
              <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)} aria-pressed={r.mine}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', your reaction' : ''}`}
                className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs shadow-sm border ${r.mine ? 'bg-wa-green/15 border-wa-green/40' : 'bg-wa-lightPanel dark:bg-wa-darkSecondary border-wa-lightBorder dark:border-wa-darkBorder'} text-wa-lightText dark:text-wa-darkText`}>
                <span className="text-sm leading-none">{r.emoji}</span>{r.count > 1 && <span className="tabular-nums">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {!mine && (
        <button type="button" onClick={() => setBar((v) => !v)} aria-label="React to message"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:bg-black/5 dark:hover:bg-white/10 transition-opacity">
          <SmilePlus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
