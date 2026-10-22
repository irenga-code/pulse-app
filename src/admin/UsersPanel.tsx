import { useState } from 'react';
import { Search, Loader2, BadgeCheck } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import { Spinner, ErrorNote, inputClass, primaryBtn, ghostBtn, dangerBtn, mutedText, bodyText } from '@/components/ui';
import { StatusChip, panelCard } from '@/admin/shared';
import { formatDateTime } from '@/lib/time';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { AccountStatus, AccountType, Profile } from '@/lib/types';
import { memUserKey } from '@/lib/cache';

function UserRow({ profile, isSelf, onChanged }: { profile: Profile; isSelf: boolean; onChanged: () => void }) {
  const { show } = useToast();
  const [target, setTarget] = useState<AccountStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [role, setRole] = useState<AccountType>(profile.account_type);
  const [verified, setVerified] = useState(profile.is_verified);

  const saveRole = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.adminSetUserRole(profile.id, role, verified);
      show(`${profile.display_name}'s role updated`);
      setRoleOpen(false);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const apply = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminSetUserStatus(profile.id, target, reason);
      show(`${profile.display_name} is now ${target}`);
      setTarget(null);
      setReason('');
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const actions: { status: AccountStatus; label: string; danger?: boolean }[] =
    profile.status === 'active'
      ? [{ status: 'suspended', label: 'Suspend' }, { status: 'banned', label: 'Ban', danger: true }]
      : profile.status === 'suspended'
        ? [{ status: 'active', label: 'Reinstate' }, { status: 'banned', label: 'Ban', danger: true }]
        : [{ status: 'active', label: 'Reinstate' }];

  return (
    <div className={panelCard}>
      <div className="flex items-center gap-3">
        <Avatar name={profile.display_name} url={profile.avatar_url} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-semibold text-sm ${bodyText}`}>{profile.display_name}</span>
            <RoleBadge accountType={profile.account_type} verified={profile.is_verified} />
            <StatusChip status={profile.status} />
          </div>
          <p className={`text-[11px] mt-0.5 ${mutedText}`}>Joined {formatDateTime(profile.created_at)} · {profile.id.slice(0, 8)}</p>
        </div>
        {!target && !roleOpen && (
          <button onClick={() => { setRoleOpen(true); setRole(profile.account_type); setVerified(profile.is_verified); setError(null); }}
            className="text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightText dark:text-wa-darkText">
            Role
          </button>
        )}
        {isSelf ? (
          <span className={`text-xs ${mutedText}`}>You</span>
        ) : (
          !target && !roleOpen && (
            <div className="flex gap-1.5">
              {actions.map((a) => (
                <button key={a.status} onClick={() => setTarget(a.status)} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${a.danger ? 'border-wa-live/50 text-wa-live' : 'border-wa-lightBorder dark:border-wa-darkBorder text-wa-lightText dark:text-wa-darkText'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>
      {roleOpen && (
        <div className="mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder space-y-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <span className={mutedText}>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as AccountType)} aria-label={`Role of ${profile.display_name}`} className={`${inputClass} !w-auto !py-1.5`}>
                <option value="user">User</option>
                <option value="host">Performer / Staff (Host)</option>
                <option value="venue">Venue account</option>
              </select>
            </label>
            <label className={`flex items-center gap-2 text-xs ${bodyText}`}>
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="accent-wa-green" />
              <BadgeCheck className="w-3.5 h-3.5 text-wa-green" />Verified badge
            </label>
          </div>
          <p className={`text-[11px] ${mutedText}`}>Venue links (manager / host of a club) are managed in the Venue staff tab.</p>
          {error && <ErrorNote message={error} />}
          <div className="flex gap-2">
            <button onClick={saveRole} disabled={busy} className={primaryBtn}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}Save role
            </button>
            <button onClick={() => { setRoleOpen(false); setError(null); }} disabled={busy} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
      {target && (
        <div className="mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder space-y-2.5">
          <p className={`text-xs ${bodyText}`}>
            {target === 'banned' ? 'Ban' : target === 'suspended' ? 'Suspend' : 'Reinstate'} <b>{profile.display_name}</b>?
            {target === 'banned' && ' They will also be blocked from signing in.'}
          </p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (sent to the user)" className={inputClass} />
          {error && <ErrorNote message={error} />}
          <div className="flex gap-2">
            <button onClick={apply} disabled={busy} className={target === 'banned' ? dangerBtn : primaryBtn}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm
            </button>
            <button onClick={() => { setTarget(null); setError(null); }} disabled={busy} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsersPanel() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const users = useAsync(() => api.adminSearchUsers(applied), [], user ? memUserKey(user.id, `admin-users:${applied}`) : null);

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); setApplied(query); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by display name" className={`${inputClass} pl-9`} aria-label="Search users" />
        </div>
        <button type="submit" className={primaryBtn}>Search</button>
      </form>
      {users.loading && !users.data ? (
        <Spinner />
      ) : users.error ? (
        <ErrorNote message={users.error} />
      ) : users.data!.length === 0 ? (
        <p className={`text-sm text-center py-8 ${mutedText}`}>No users found.</p>
      ) : (
        users.data!.map((p) => <UserRow key={p.id} profile={p} isSelf={p.id === user?.id} onChanged={users.reload} />)
      )}
    </div>
  );
}
