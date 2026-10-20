import { useRef, useState } from 'react';
import { Send, Loader2, Camera } from 'lucide-react';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { insertAtCaret } from '@/components/emoji/emojiData';
import Avatar from '@/components/Avatar';
import { inputClass, primaryBtn, mutedText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useVenues } from '@/hooks/useVenues';
import { friendlyError } from '@/lib/api';

const MAX = 1000;

type Props = { onSubmit: (content: string, venueId: string | null) => Promise<void>; onOpenCamera?: () => void };

export default function ComposePost({ onSubmit, onOpenCamera }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { user, profile, canWrite, openAuth, refreshProfile } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const [text, setText] = useState('');
  const [venueId, setVenueId] = useState('');
  const [busy, setBusy] = useState(false);

  const card = 'bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-4 border border-wa-lightBorder dark:border-wa-darkBorder';

  if (!user) {
    return (
      <div className={`${card} flex items-center gap-3`}>
        <p className={`text-sm flex-1 ${mutedText}`}>Share what is happening tonight with Kampala.</p>
        <button onClick={() => openAuth('signin', 'Sign in to post to the community.')} className={primaryBtn}>Sign in to post</button>
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className={`${card} text-sm ${mutedText}`}>
        Your account is {profile?.status ?? 'restricted'}, so you can read the community but not post. Contact the Pulse team if you think this is a mistake.
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      await onSubmit(content, venueId || null);
      setText('');
      setVenueId('');
      show('Posted');
    } catch (err) {
      show(friendlyError(err), 'error');
      refreshProfile();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className={card}>
      <div className="flex items-start gap-3">
        <Avatar name={profile?.display_name ?? 'You'} url={profile?.avatar_url} />
        <div className="flex-1 min-w-0 space-y-2.5">
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            rows={text.length > 80 ? 4 : 2}
            placeholder="What's the vibe tonight?"
            aria-label="Write a post"
            className={`${inputClass} resize-none`}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              aria-label="Tag a venue"
              className={`${inputClass} !w-auto py-1.5 text-xs`}
            >
              <option value="">No venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name} · {v.location}</option>
              ))}
            </select>
            <EmojiButton
              label="Add emoji to post"
              onPick={(e) => {
                const { value, caret } = insertAtCaret(areaRef.current, text, e, MAX);
                setText(value);
                requestAnimationFrame(() => { areaRef.current?.focus(); areaRef.current?.setSelectionRange(caret, caret); });
              }}
            />
            {onOpenCamera && (
              <button type="button" onClick={onOpenCamera} aria-label="Open camera" className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-wa-green border border-wa-green/40 hover:bg-wa-green/10 transition-colors">
                <Camera className="w-4 h-4" />Snap
              </button>
            )}
            <span className={`text-[11px] ml-auto ${text.length > MAX - 50 ? 'text-wa-live' : mutedText}`}>{text.length}/{MAX}</span>
            <button type="submit" disabled={busy || !text.trim()} className={`${primaryBtn} !py-1.5`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Post
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
