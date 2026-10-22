import { useState } from 'react';
import { BadgeCheck, Loader2, Mic2, Store, UserMinus, LogOut } from 'lucide-react';
import { ErrorNote, dangerBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { revalidateAll, userKey } from '@/lib/cache';
import type { VenueRole } from '@/lib/types';

const accountLabel = { host: 'Performer / Staff (Host badge)', venue: 'Venue account (Venue badge)' } as const;
const venueRoleLabel: Record<VenueRole, string> = { owner: 'Owner', manager: 'Manager', host: 'Host' };
const row = 'flex items-center gap-3 py-3';

/**
 * Settings > Manage my roles: see your badge and venue links, and give up any that were assigned by mistake
 * (relinquish_my_role / leave_venue, migration 13). Getting one back needs a new verification request.
 */
export default function MyRolesSection() {
  const { user, profile, refreshProfile } = useAuth();
  const { show } = useToast();
  const { venues } = useVenues({ orderBy: 'name' });
  const links = useAsync(() => api.managedVenues(user!.id), [], user ? userKey(user.id, 'managed-venue-roles') : null);
  // 'account' or a venue id
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !profile) return null;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      show(ok);
      setConfirming(null);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const dropRole = () =>
    run(async () => {
      await api.relinquishMyRole();
      await refreshProfile();
    }, 'Role removed');

  const leave = (venueId: string, name: string) =>
    run(async () => {
      await api.leaveVenue(venueId);
      await links.reload();
      revalidateAll();
    }, `You left ${name}`);

  const mine = (links.data ?? []).map((l) => ({ ...l, venue: venues.find((v) => v.id === l.venue_id) }));
  const hasAccountRole = profile.account_type !== 'user';
  const nothing = !hasAccountRole && !profile.is_verified && mine.length === 0 && !links.loading;

  const confirmBar = (text: string, onYes: () => void) => (
    <div className="pb-3 -mt-1 space-y-2">
      <p className={`text-xs ${mutedText}`}>{text}</p>
      <div className="flex gap-2">
        <button onClick={onYes} disabled={busy} className={`${dangerBtn} !py-1.5 text-xs`}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Yes, remove
        </button>
        <button onClick={() => setConfirming(null)} disabled={busy} className={`${ghostBtn} !py-1.5 text-xs`}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide mt-5 mb-1 ${mutedText}`}>Manage my roles</p>
      <p className={`text-xs mb-1 ${mutedText}`}>Remove a badge or venue link that was given by mistake. To get one back, use Request verification.</p>
      {error && <div className="my-2"><ErrorNote message={error} /></div>}

      <div className="divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
        {nothing && <p className={`text-sm py-3 ${mutedText}`}>You have no roles or badges.</p>}

        {(hasAccountRole || profile.is_verified) && (
          <div>
            <div className={row}>
              {profile.account_type === 'venue' ? <Store className={`w-5 h-5 ${mutedText}`} /> : profile.account_type === 'host' ? <Mic2 className={`w-5 h-5 ${mutedText}`} /> : <BadgeCheck className={`w-5 h-5 ${mutedText}`} />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${bodyText}`}>
                  {profile.account_type === 'user' ? 'Verified badge' : accountLabel[profile.account_type]}
                </p>
                {profile.is_verified && profile.account_type !== 'user' && <p className={`text-xs ${mutedText}`}>Verified</p>}
              </div>
              {confirming !== 'account' && (
                <button onClick={() => setConfirming('account')} className={`${ghostBtn} !px-3 !py-1.5 text-xs`}>
                  <UserMinus className="w-3.5 h-3.5" />Remove
                </button>
              )}
            </div>
            {confirming === 'account' && confirmBar('Remove this role and its badge from your profile? Your venue links below stay.', dropRole)}
          </div>
        )}

        {mine.map(({ venue_id, role, venue }) => {
          const name = venue?.name ?? 'a venue';
          const registered = venue?.created_by === user.id;
          return (
            <div key={venue_id}>
              <div className={row}>
                <Store className={`w-5 h-5 ${mutedText}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${bodyText}`}>{venueRoleLabel[role]} at {name}</p>
                  {registered && <p className={`text-xs ${mutedText}`}>You registered it. Manage or delete it in My venue.</p>}
                </div>
                {!registered && confirming !== venue_id && (
                  <button onClick={() => setConfirming(venue_id)} className={`${ghostBtn} !px-3 !py-1.5 text-xs`}>
                    <LogOut className="w-3.5 h-3.5" />Leave
                  </button>
                )}
              </div>
              {confirming === venue_id && confirmBar(`Leave ${name}? You will no longer be able to manage it.`, () => leave(venue_id, name))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
