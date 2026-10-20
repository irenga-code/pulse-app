import { Plus } from 'lucide-react';
import Avatar from '@/components/Avatar';
import type { StatusGroup } from '@/hooks/useStatuses';
import type { PublicProfile } from '@/lib/types';

/**
 * Row of status bubbles above the feed. A colourful ring means there is something you have not seen yet;
 * a grey ring means you have seen everything. The first bubble is yours (+ adds a new status).
 */
export default function StatusTray({ groups, authors, myName, myAvatar, onOpen, onAdd }: {
  groups: StatusGroup[];
  authors: Record<string, PublicProfile>;
  myName: string;
  myAvatar?: string | null;
  onOpen: (groupIndex: number) => void;
  onAdd: () => void;
}) {
  const mineIndex = groups.findIndex((g) => g.isMine);
  const others = groups.map((g, i) => ({ g, i })).filter(({ g }) => !g.isMine);

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide py-1" role="list" aria-label="Statuses">
      <div role="listitem" className="relative flex flex-col items-center gap-1 flex-shrink-0 w-16">
        <button
          onClick={() => (mineIndex >= 0 ? onOpen(mineIndex) : onAdd())}
          aria-label={mineIndex >= 0 ? 'View your status' : 'Add a status'}
          className={`w-16 h-16 rounded-full p-[3px] ${mineIndex >= 0 ? 'bg-wa-green/70' : 'border-2 border-dashed border-wa-green/60'}`}
        >
          <span className="block w-full h-full rounded-full overflow-hidden border-2 border-wa-light dark:border-wa-dark">
            <Avatar name={myName} url={myAvatar} size={56} />
          </span>
        </button>
        <button onClick={onAdd} aria-label="Add to your status" className="absolute top-11 right-0 w-5 h-5 rounded-full bg-wa-green text-white flex items-center justify-center border-2 border-wa-light dark:border-wa-dark">
          <Plus className="w-3 h-3" strokeWidth={3} />
        </button>
        <span className="text-[11px] text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">Your status</span>
      </div>

      {others.map(({ g, i }) => {
        const a = authors[g.userId];
        const name = a?.display_name ?? 'Pulse user';
        return (
          <button key={g.userId} role="listitem" onClick={() => onOpen(i)} aria-label={`${g.unseen ? 'New status' : 'Status'} from ${name}`} data-unseen={g.unseen} className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
            <span className={`w-16 h-16 rounded-full p-[3px] ${g.unseen ? 'bg-gradient-to-tr from-wa-green via-pink-500 to-yellow-400' : 'bg-wa-quiet/50'}`}>
              <span className="block w-full h-full rounded-full overflow-hidden border-2 border-wa-light dark:border-wa-dark">
                <Avatar name={name} url={a?.avatar_url} size={56} />
              </span>
            </span>
            <span className={`text-[11px] w-16 truncate text-center ${g.unseen ? 'font-semibold text-wa-lightText dark:text-wa-darkText' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'}`}>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
