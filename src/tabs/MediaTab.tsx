import { useState } from 'react';
import { Images, Play, CircleDashed } from 'lucide-react';
import SectionHeader from '@/components/nav/SectionHeader';
import Modal from '@/components/Modal';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { userKey } from '@/lib/cache';
import { timeAgo } from '@/lib/time';

type Item = Awaited<ReturnType<typeof api.myMedia>>[number];

/** Media gallery: the snaps you posted and your live status updates, in a grid. */
export default function MediaTab() {
  const { user } = useAuth();
  const media = useAsync(() => (user ? api.myMedia(user.id) : Promise.resolve([] as Item[])), [], user ? userKey(user.id, 'my-media') : null);
  const [open, setOpen] = useState<Item | null>(null);

  return (
    <div className="flex flex-col pb-8">
      <SectionHeader title="Media" subtitle="Your snaps and status updates" />
      {!user ? (
        <p className={`px-4 text-sm ${mutedText}`}>Sign in to see your media.</p>
      ) : media.error ? (
        <div className="px-4"><ErrorNote message={media.error} /></div>
      ) : media.loading && !media.data ? (
        <p className={`px-4 text-sm ${mutedText}`}>Loading…</p>
      ) : (media.data ?? []).length === 0 ? (
        <div className="text-center px-8 py-16">
          <Images className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
          <p className={`text-sm font-medium ${bodyText}`}>No media yet</p>
          <p className={`text-xs mt-1 ${mutedText}`}>Photos and videos you snap to the feed or your status show up here.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1 px-1 md:px-4" aria-label="Your media">
          {media.data!.map((m) => (
            <li key={`${m.source}:${m.id}`}>
              <button onClick={() => setOpen(m)} aria-label={`${m.media_type === 'video' ? 'Video' : 'Photo'} from ${timeAgo(m.created_at)}`}
                className="relative block w-full aspect-square overflow-hidden rounded-md bg-black">
                {m.media_type === 'video'
                  ? <video src={m.media_url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  : <img src={m.media_url} alt="" loading="lazy" className="w-full h-full object-cover" />}
                {m.media_type === 'video' && <Play className="absolute top-1.5 right-1.5 w-4 h-4 text-white drop-shadow" />}
                {m.source === 'status' && <CircleDashed className="absolute bottom-1.5 left-1.5 w-4 h-4 text-wa-green drop-shadow" aria-label="Status" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Modal title={open.source === 'status' ? 'Status' : 'Snap'} icon={Images} onClose={() => setOpen(null)}>
          {open.media_type === 'video'
            ? <video src={open.media_url} controls autoPlay playsInline className="w-full max-h-[65vh] rounded-xl bg-black" />
            : <img src={open.media_url} alt={open.caption ?? ''} className="w-full max-h-[65vh] object-contain rounded-xl bg-black" />}
          {open.caption && <p className={`text-sm mt-3 ${bodyText}`}>{open.caption}</p>}
          <p className={`text-xs mt-1 ${mutedText}`}>{timeAgo(open.created_at)}</p>
        </Modal>
      )}
    </div>
  );
}
