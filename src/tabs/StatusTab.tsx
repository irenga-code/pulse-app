import { lazy, Suspense, useMemo, useState } from 'react';
import { Camera, ImagePlus, Plus } from 'lucide-react';
import Avatar from '@/components/Avatar';
import StatusViewerModal from '@/components/status/StatusViewerModal';
import SectionHeader, { headerIconBtn } from '@/components/nav/SectionHeader';
import { mutedText, bodyText } from '@/components/ui';
import { useStatuses, type StatusGroup } from '@/hooks/useStatuses';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { timeAgo } from '@/lib/time';

const StatusComposer = lazy(() => import('@/components/status/StatusComposer'));

/** The segmented ring: one arc per status, green until seen, grey after. */
function StatusRing({ group, children }: { group: StatusGroup; children: React.ReactNode }) {
  const n = group.items.length;
  const r = 27;
  const c = 2 * Math.PI * r;
  const gap = n > 1 ? 4 : 0;
  const seg = c / n - gap;
  return (
    <span className="relative w-[60px] h-[60px] flex items-center justify-center flex-shrink-0">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60" aria-hidden="true">
        {group.items.map((s, i) => (
          <circle key={s.id} cx="30" cy="30" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
            className={group.unseen || group.isMine ? 'stroke-wa-green' : 'stroke-wa-lightBorder dark:stroke-wa-darkBorder'}
            strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={-i * (seg + gap)} />
        ))}
      </svg>
      {children}
    </span>
  );
}

/** Status updates: your 24 h status first, then recent (unseen) and viewed updates, WhatsApp-style. */
export function StatusSection({ compact = false }: { compact?: boolean }) {
  const { user, profile, requireAuth } = useAuth();
  const { openQuickSnap } = useQuickSnap();
  const statuses = useStatuses();
  const { venues } = useVenues();
  const venueNames = useMemo(() => Object.fromEntries(venues.map((v) => [v.id, v.name])), [venues]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);

  const mineIndex = statuses.groups.findIndex((g) => g.isMine);
  const recent = statuses.groups.map((g, i) => ({ g, i })).filter(({ g }) => !g.isMine && g.unseen);
  const viewed = statuses.groups.map((g, i) => ({ g, i })).filter(({ g }) => !g.isMine && !g.unseen);
  const snap = () => openQuickSnap({ onSent: () => { void statuses.reload(); } });

  const row = (g: StatusGroup, i: number) => {
    const a = statuses.authors[g.userId];
    const last = g.items[g.items.length - 1];
    const venue = last.venue_id ? venueNames[last.venue_id] : null;
    return (
      <li key={g.userId}>
        <button onClick={() => setViewer(i)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-wa-lightSecondary dark:hover:bg-wa-darkSecondary/60 transition-colors">
          <StatusRing group={g}><Avatar name={a?.display_name ?? '?'} url={a?.avatar_url} size={50} /></StatusRing>
          <span className="min-w-0">
            <span className={`block text-sm font-semibold truncate ${bodyText}`}>{a?.display_name ?? 'Pulse user'}</span>
            <span className={`block text-xs truncate ${mutedText}`}>{timeAgo(last.created_at)}{venue ? ` · 📍 ${venue}` : ''}</span>
          </span>
        </button>
      </li>
    );
  };
  const label = `text-xs font-semibold uppercase tracking-wide px-4 pt-4 pb-1 ${mutedText}`;

  return (
    <section aria-label="Status updates">
      {compact && <h2 className={`text-lg font-bold px-4 pt-3 ${bodyText}`}>Status</h2>}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button
          onClick={() => (mineIndex >= 0 ? setViewer(mineIndex) : requireAuth('Sign in to post a status update.') && snap())}
          aria-label={mineIndex >= 0 ? 'View my status' : 'Add status update'}
          className="relative flex-shrink-0"
        >
          {mineIndex >= 0
            ? <StatusRing group={statuses.groups[mineIndex]}><Avatar name={profile?.display_name ?? 'You'} url={profile?.avatar_url} size={50} /></StatusRing>
            : <span className="w-[60px] h-[60px] flex items-center justify-center"><Avatar name={profile?.display_name ?? 'You'} url={profile?.avatar_url} size={54} /></span>}
          <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-wa-green text-white flex items-center justify-center border-2 border-wa-light dark:border-wa-dark">
            <Plus className="w-3 h-3" strokeWidth={3} />
          </span>
        </button>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-semibold ${bodyText}`}>My status</span>
          <span className={`block text-xs ${mutedText}`}>
            {mineIndex >= 0 ? `${statuses.groups[mineIndex].items.length} update${statuses.groups[mineIndex].items.length === 1 ? '' : 's'} · tap to view` : 'Tap to add status update. It disappears after 24 hours.'}
          </span>
        </span>
        {user && (
          <>
            <button onClick={snap} aria-label="Snap a status update" className={headerIconBtn}><Camera className="w-5 h-5" /></button>
            <button onClick={() => setComposing(true)} aria-label="Post a status update from your gallery" className={headerIconBtn}><ImagePlus className="w-5 h-5" /></button>
          </>
        )}
      </div>

      {recent.length > 0 && <><p className={label}>Recent updates</p><ul>{recent.map(({ g, i }) => row(g, i))}</ul></>}
      {viewed.length > 0 && <><p className={label}>Viewed updates</p><ul>{viewed.map(({ g, i }) => row(g, i))}</ul></>}
      {recent.length === 0 && viewed.length === 0 && !statuses.loading && (
        <p className={`text-xs px-4 py-3 ${mutedText}`}>No status updates from others right now. They show up here for 24 hours.</p>
      )}

      {viewer !== null && statuses.groups.length > 0 && (
        <StatusViewerModal groups={statuses.groups} startGroup={viewer} authors={statuses.authors} venueNames={venueNames}
          onViewed={statuses.markViewed} onChanged={statuses.reload} onClose={() => setViewer(null)} />
      )}
      {composing && (
        <Suspense fallback={null}>
          <StatusComposer onClose={() => setComposing(false)} onPosted={statuses.reload} />
        </Suspense>
      )}
    </section>
  );
}

export default function StatusTab() {
  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Status updates" subtitle="24-hour photo, video, and text updates from your community" />
      <StatusSection />
    </div>
  );
}
