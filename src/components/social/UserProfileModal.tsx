import { useState } from 'react';
import { UserPlus, UserCheck, MessageCircle, Flame, Loader2, Flag, UserRound } from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import ReportModal from '@/components/community/ReportModal';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { Spinner, ErrorNote, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { Stat } from '@/components/social/Stat';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import { userKey } from '@/lib/cache';

/**
 * Someone's public profile: follow / unfollow, message, and their Vibe Rep
 * (the reactions and likes their posts and snaps have earned).
 */
export default function UserProfileModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { user, canWrite, requireAuth } = useAuth();
  const { show } = useToast();
  const { openChat } = useSocial();
  const me = user?.id ?? null;
  const isMe = me === userId;
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);

  const data = useAsync(async () => {
    const [profile, stats, following] = await Promise.all([
      api.getProfile(userId),
      api.profileStats(userId),
      me && me !== userId ? api.isFollowingUser(me, userId) : Promise.resolve(false),
    ]);
    return { profile, stats, following };
  }, [], me ? userKey(me, `profile:${userId}`) : `profile:${userId}`);

  const d = data.data;
  const toggleFollow = async () => {
    if (!requireAuth('Sign in to follow people.') || !me || !d || busy) return;
    setBusy(true);
    const was = d.following;
    // optimistic
    data.setData({ ...d, following: !was, stats: d.stats ? { ...d.stats, follower_count: Math.max(0, d.stats.follower_count + (was ? -1 : 1)) } : d.stats });
    try {
      if (was) await api.unfollowUser(me, userId); else await api.followUser(userId);
    } catch (e) {
      data.setData(d);
      show(friendlyError(e), 'error');
    }
    setBusy(false);
  };

  return (
    <Modal title={d?.profile ? d.profile.display_name : 'Profile'} icon={UserRound} onClose={onClose}>
      {data.loading && !d ? (
        <Spinner />
      ) : data.error ? (
        <ErrorNote message={data.error} />
      ) : !d?.profile ? (
        <p className={`text-sm text-center py-6 ${mutedText}`}>This profile is not available.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={d.profile.display_name} url={d.profile.avatar_url} size={72} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className={`text-lg font-bold ${bodyText}`}>{d.profile.display_name}</h3>
                <RoleBadge accountType={d.profile.account_type} verified={d.profile.is_verified} />
              </div>
              <p className={`text-xs mt-0.5 ${mutedText}`}>Member since {new Date(d.profile.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</p>
            </div>
          </div>

          {d.profile.bio && <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${bodyText}`}><EmojiText text={d.profile.bio} /></p>}

          <div className="flex rounded-2xl py-3 bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder" data-testid="profile-stats">
            <Stat label="Followers" value={d.stats?.follower_count ?? 0} />
            <Stat label="Following" value={d.stats?.following_count ?? 0} />
            <Stat label="Posts" value={d.stats?.post_count ?? 0} />
            <Stat label="Vibe Rep" value={d.stats?.vibe_rep ?? 0} icon={<Flame className="w-4 h-4 text-orange-500" />} />
          </div>
          <p className={`text-[11px] ${mutedText}`}>Vibe Rep counts the likes and emoji reactions other people have given this person's posts and snaps.</p>

          {isMe ? (
            <p className={`text-xs ${mutedText}`}>This is how others see your profile.</p>
          ) : (
            <div className="flex gap-2">
              <button onClick={toggleFollow} disabled={busy || (!!user && !canWrite)} aria-pressed={d.following} className={`${d.following ? ghostBtn : primaryBtn} flex-1`}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : d.following ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                {d.following ? 'Following' : 'Follow'}
              </button>
              <button onClick={() => openChat(userId)} disabled={!!user && !canWrite} className={`${ghostBtn} flex-1`}>
                <MessageCircle className="w-4 h-4" />Message
              </button>
              <button onClick={() => (requireAuth('Sign in to report people.') ? setReporting(true) : undefined)} aria-label="Report user" className={`${ghostBtn} !px-3`}>
                <Flag className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
      {reporting && <ReportModal targetType="user" targetId={userId} onClose={() => setReporting(false)} />}
    </Modal>
  );
}
