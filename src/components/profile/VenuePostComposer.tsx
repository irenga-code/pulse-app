import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { inputClass, primaryBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { Venue } from '@/lib/types';

const MAX = 1000;

/** Publishes to the community feed as the venue (posts.as_venue); the database checks the venue link. */
export default function VenuePostComposer({ venue }: { venue: Venue }) {
  const { show } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      await api.createPost({ content, venue_id: venue.id, as_venue: true });
      setText('');
      show(`Posted as ${venue.name}`);
    } catch (err) {
      show(friendlyError(err), 'error');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex items-start gap-3">
      <Avatar name={venue.name} url={venue.image_url} size={36} />
      <div className="flex-1 min-w-0 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          rows={text.length > 80 ? 4 : 2}
          placeholder={`Tonight at ${venue.name}...`}
          aria-label={`Post as ${venue.name}`}
          className={`${inputClass} resize-none`}
        />
        <div className="flex items-center gap-2">
          <span className={`text-[11px] ${text.length > MAX - 50 ? 'text-wa-live' : mutedText}`}>{text.length}/{MAX}</span>
          <button type="submit" disabled={busy || !text.trim()} className={`${primaryBtn} !py-1.5 ml-auto`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Post as venue
          </button>
        </div>
      </div>
    </form>
  );
}
