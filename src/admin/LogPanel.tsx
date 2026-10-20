import { Spinner, ErrorNote, mutedText, bodyText } from '@/components/ui';
import { panelCard } from '@/admin/shared';
import { formatDateTime } from '@/lib/time';
import { api } from '@/lib/apiClient';
import { useAsync } from '@/hooks/useAsync';
import { memUserKey } from '@/lib/cache';
import { useAuth } from '@/context/AuthContext';

export default function LogPanel() {
  const { user } = useAuth();
  const data = useAsync(async () => {
    const rows = await api.adminModerationLog();
    const admins = await api.profilesByIds(rows.map((r) => r.admin_id).filter((x): x is string => !!x));
    return { rows, admins };
  }, [], user ? memUserKey(user.id, 'admin-log') : null);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) return <ErrorNote message={data.error} />;
  if (data.data!.rows.length === 0) return <p className={`text-sm text-center py-10 ${mutedText}`}>No moderation activity yet.</p>;

  return (
    <div className={`${panelCard} !p-0 overflow-hidden`}>
      <ul className="divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
        {data.data!.rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${bodyText}`}>{r.action.replace(/_/g, ' ')}</span>
              <span className={`text-xs ${mutedText}`}>
                {r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ''}
              </span>
              <span className={`text-[11px] ml-auto ${mutedText}`}>{formatDateTime(r.created_at)}</span>
            </div>
            <p className={`text-xs mt-0.5 ${mutedText}`}>
              by {(r.admin_id && data.data!.admins[r.admin_id]?.display_name) || 'an administrator'}
              {r.note ? ` — ${r.note}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
