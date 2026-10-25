import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { MessageCircle, AlertCircle, Camera, Mail } from 'lucide-react';
import ComposePost from '@/components/community/ComposePost';
import PostCard from '@/components/community/PostCard';
import SnapRail from '@/components/snaps/SnapRail';
import SnapViewer from '@/components/snaps/SnapViewer';
import StatusTray from '@/components/status/StatusTray';
import StatusViewerModal from '@/components/status/StatusViewerModal';
import { useFeed } from '@/hooks/useFeed';
import { useStatuses } from '@/hooks/useStatuses';
import { useEngagement } from '@/hooks/useEngagement';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useSocial } from '@/context/SocialContext';
import { FeedSkeleton } from '@/components/Skeleton';

// the camera is a big module: only load it when someone opens it
const CameraModal = lazy(() => import('@/camera/CameraModal'));
const StatusComposer = lazy(() => import('@/components/status/StatusComposer'));

export default function CommunityTab() {
  const feed = useFeed();
  const { user, profile, requireAuth } = useAuth();
  const { openInbox, unread } = useSocial();
  const statuses = useStatuses();
  const { venues } = useVenues();
  const venueNames = useMemo(() => Object.fromEntries(venues.map((v) => [v.id, v.name])), [venues]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [statusViewer, setStatusViewer] = useState<number | null>(null);
  const [composingStatus, setComposingStatus] = useState(false);

  // snaps expire after 24 h: drop them from the screen when their time is up
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const posts = useMemo(() => feed.posts.filter((p) => !p.expires_at || new Date(p.expires_at).getTime() > now), [feed.posts, now]);
  const snaps = useMemo(() => posts.filter((p) => p.kind === 'snap' && p.media_url), [posts]);
  const engagement = useEngagement(posts);

  const openCamera = () => { if (requireAuth('Sign in to post snaps.')) setCameraOpen(true); };
  const addStatus = () => { if (requireAuth('Sign in to post a status.')) setComposingStatus(true); };

  return (
    <div className="flex flex-col h-full bg-wa-light dark:bg-wa-dark">
      <div className="px-4 md:px-8 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-wa-green" />
          <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText flex-1">Community</h1>
          <button onClick={openInbox} aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'} className="relative p-2 rounded-full text-wa-lightTextSecondary dark:text-wa-darkTextSecondary hover:text-wa-green hover:bg-wa-green/10 transition-colors">
            <Mail className="w-6 h-6" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-wa-live text-white text-[10px] font-bold flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>
            )}
          </button>
        </div>
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-0.5">
          See what's happening right now
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-28 md:pb-8">
        <div className="w-full max-w-2xl ml-0 mr-auto flex flex-col items-start text-left space-y-3 [&>*]:w-full">
          <StatusTray
            groups={statuses.groups}
            authors={statuses.authors}
            myName={profile?.display_name ?? 'You'}
            myAvatar={profile?.avatar_url}
            onOpen={setStatusViewer}
            onAdd={addStatus}
          />
          <SnapRail snaps={snaps} onOpen={setViewer} onCamera={openCamera} />
          <ComposePost onSubmit={feed.createPost} onOpenCamera={openCamera} />

          {feed.loading ? (
            <FeedSkeleton />
          ) : feed.error ? (
            <div className="flex flex-col items-start py-16">
              <AlertCircle className="w-10 h-10 text-wa-live" />
              <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3">
                Something went wrong. Please try again.
              </p>
              <button onClick={feed.reload} className="mt-3 text-xs font-semibold text-wa-green">Retry</button>
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-start py-16">
              <MessageCircle className="w-12 h-12 text-wa-quiet mb-3" />
              <p className="text-sm font-medium text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">No live updates yet</p>
              <p className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-1 max-w-xs">
                Be the first to post about tonight's vibe.
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                author={post.user_id ? feed.authors[post.user_id] : undefined}
                counts={feed.counts[post.id] ?? {}}
                mine={feed.mine[post.id] ?? null}
                onReact={(kind) => feed.react(post.id, kind)}
                onDelete={() => feed.removeOwnPost(post.id)}
                onEdit={(content) => feed.editOwnPost(post.id, content)}
                onAdminRemove={() => feed.adminRemovePost(post.id)}
                bursts={feed.bursts[post.id] ?? []}
                onBurstDone={(id) => feed.dismissBurst(post.id, id)}
                onCommentCount={(d) => feed.bumpComments(post.id, d)}
                engagement={{
                  reposted: engagement.reposted.has(post.id),
                  repostCount: engagement.repostCount(post),
                  onRepost: (q) => engagement.toggleRepost(post.id, q),
                  saved: engagement.saved.has(post.id),
                  onSave: () => engagement.toggleSave(post.id),
                }}
              />
            ))
          )}
        </div>
      </div>

      <button
        onClick={openCamera}
        aria-label="Open camera"
        className="fixed z-30 right-4 bottom-24 md:bottom-8 md:right-8 w-14 h-14 rounded-full bg-wa-green text-white shadow-xl flex items-center justify-center hover:bg-wa-greenDark active:scale-90 transition-all"
      >
        <Camera className="w-6 h-6" />
      </button>

      {viewer !== null && snaps.length > 0 && (
        <SnapViewer
          snaps={snaps}
          start={viewer}
          authors={feed.authors}
          counts={feed.counts}
          mine={feed.mine}
          bursts={feed.bursts}
          onReact={feed.react}
          onBurstDone={feed.dismissBurst}
          onClose={() => setViewer(null)}
        />
      )}
      {statusViewer !== null && statuses.groups.length > 0 && (
        <StatusViewerModal
          groups={statuses.groups}
          startGroup={statusViewer}
          authors={statuses.authors}
          venueNames={venueNames}
          onViewed={statuses.markViewed}
          onChanged={statuses.reload}
          onClose={() => setStatusViewer(null)}
        />
      )}
      {composingStatus && user && (
        <Suspense fallback={null}>
          <StatusComposer onClose={() => setComposingStatus(false)} onPosted={statuses.reload} />
        </Suspense>
      )}
      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraModal onClose={() => setCameraOpen(false)} savePost={feed.publish} defaultDestinations={[{ kind: 'feed' }]} />
        </Suspense>
      )}
    </div>
  );
}
