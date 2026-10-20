import { Camera, Plus } from 'lucide-react';
import type { Post } from '@/lib/types';

/** Horizontal "stories" row: your camera button + every live snap (they expire after 24 h). */
export default function SnapRail({ snaps, onOpen, onCamera }: { snaps: Post[]; onOpen: (index: number) => void; onCamera: () => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide py-1" role="list" aria-label="Live snaps">
      <button onClick={onCamera} aria-label="Add a snap" role="listitem" className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
        <span className="relative w-16 h-16 rounded-full border-2 border-dashed border-wa-green/60 flex items-center justify-center bg-wa-lightPanel dark:bg-wa-darkSecondary">
          <Camera className="w-6 h-6 text-wa-green" />
          <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-wa-green text-white flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></span>
        </span>
        <span className="text-[11px] text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">Add snap</span>
      </button>
      {snaps.map((s, i) => (
        <button key={s.id} onClick={() => onOpen(i)} aria-label={`Open snap from ${s.venue_name ?? s.user_name}`} role="listitem" className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
          <span className="w-16 h-16 rounded-full p-[3px] bg-gradient-to-tr from-wa-green via-pink-500 to-yellow-400">
            <span className="block w-full h-full rounded-full overflow-hidden bg-black border-2 border-wa-light dark:border-wa-dark">
              {s.media_type === 'video' ? (
                <video src={`${s.media_url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              ) : (
                <img src={s.media_url ?? ''} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
            </span>
          </span>
          <span className="text-[11px] w-16 truncate text-center text-wa-lightText dark:text-wa-darkText">{s.venue_name ?? s.user_name}</span>
        </button>
      ))}
    </div>
  );
}
