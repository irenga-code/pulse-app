import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { Spinner, ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { Chip, StatusChip, FilterToggle, panelCard } from '@/admin/shared';
import { formatDateTime } from '@/lib/time';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAsync } from '@/hooks/useAsync';
import { useToast } from '@/context/ToastContext';
import { REPORT_REASONS, type PublicProfile, type ReportRow } from '@/lib/types';
import { memUserKey } from '@/lib/cache';
import { useAuth } from '@/context/AuthContext';

type Choice = 'dismiss' | 'remove' | 'remove_suspend' | 'remove_ban' | 'suspend' | 'ban' | 'mark';

const contentTypes = ['post', 'comment', 'review', 'status'];

function choicesFor(r: ReportRow): { value: Choice; label: string; hint?: string }[] {
  if (contentTypes.includes(r.target_type)) {
    const base: { value: Choice; label: string; hint?: string }[] = [
      { value: 'dismiss', label: 'Dismiss', hint: 'No violation' },
      { value: 'remove', label: 'Remove content' },
    ];
    if (r.target_user_id) {
      base.push({ value: 'remove_suspend', label: 'Remove content and suspend author' });
      base.push({ value: 'remove_ban', label: 'Remove content and ban author' });
    }
    return base;
  }
  if (r.target_type === 'user') {
    return [
      { value: 'dismiss', label: 'Dismiss', hint: 'No violation' },
      { value: 'suspend', label: 'Suspend user' },
      { value: 'ban', label: 'Ban user', hint: 'Also blocks sign-in' },
    ];
  }
  return [
    { value: 'dismiss', label: 'Dismiss', hint: 'No violation' },
    { value: 'mark', label: 'Mark as actioned', hint: 'You dealt with it elsewhere' },
  ];
}

function ReportCard({ report, author, onDone }: { report: ReportRow; author?: PublicProfile; onDone: () => void }) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = REPORT_REASONS.find((r) => r.value === report.reason)?.label ?? report.reason;

  const run = async () => {
    if (!choice) return setError('Choose an action.');
    setBusy(true);
    setError(null);
    try {
      const uid = report.target_user_id;
      if ((choice === 'suspend' || choice === 'remove_suspend') && uid) await api.adminSetUserStatus(uid, 'suspended', note);
      if ((choice === 'ban' || choice === 'remove_ban') && uid) await api.adminSetUserStatus(uid, 'banned', note);
      if (choice === 'dismiss') await api.adminResolveReport(report.id, 'dismissed', note);
      else await api.adminResolveReport(report.id, 'actioned', note, choice.startsWith('remove'));
      show('Report resolved');
      onDone();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div className={panelCard}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip>{report.target_type}</Chip>
        <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-wa-live/10 text-wa-live">{reason}</span>
        <StatusChip status={report.status} />
        <span className={`text-[11px] ml-auto ${mutedText}`}>{formatDateTime(report.created_at)}</span>
      </div>

      <blockquote className={`mt-3 text-sm leading-relaxed rounded-xl px-3 py-2 bg-wa-light dark:bg-wa-dark border-l-2 border-wa-live ${bodyText}`}>
        {report.target_preview ?? <span className={mutedText}>(content no longer available)</span>}
      </blockquote>

      {report.details && <p className={`text-xs mt-2 ${mutedText}`}>Reporter note: “{report.details}”</p>}

      <div className={`flex items-center gap-3 mt-3 text-xs flex-wrap ${mutedText}`}>
        <span>Reported by <b className={bodyText}>{report.reporter_name ?? 'unknown'}</b></span>
        {report.target_user_id && (
          <span className="flex items-center gap-1.5">
            Author <Avatar name={author?.display_name ?? '?'} url={author?.avatar_url} size={18} />
            <b className={bodyText}>{author?.display_name ?? 'unknown'}</b>
            {author && <StatusChip status={author.status} />}
          </span>
        )}
      </div>

      {report.status === 'open' &&
        (!open ? (
          <button onClick={() => setOpen(true)} className={`${primaryBtn} mt-3`}><ShieldCheck className="w-4 h-4" />Review</button>
        ) : (
          <div className="mt-4 pt-4 border-t border-wa-lightBorder dark:border-wa-darkBorder space-y-3">
            <div className="space-y-1.5">
              {choicesFor(report).map((c) => (
                <label
                  key={c.value}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm cursor-pointer border transition-colors ${
                    choice === c.value ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder'
                  } ${bodyText}`}
                >
                  <input type="radio" name={`c-${report.id}`} checked={choice === c.value} onChange={() => setChoice(c.value)} className="accent-[#00a884]" />
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className={`text-[11px] ${mutedText}`}>{c.hint}</span>}
                </label>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Note / reason (sent to the user for removals, suspensions and bans)"
              className={inputClass}
            />
            {error && <ErrorNote message={error} />}
            <div className="flex gap-2">
              <button onClick={run} disabled={busy || !choice} className={primaryBtn}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm
              </button>
              <button onClick={() => { setOpen(false); setChoice(null); setError(null); }} disabled={busy} className={ghostBtn}>Cancel</button>
            </div>
          </div>
        ))}
    </div>
  );
}

export default function ReportsPanel() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const { user } = useAuth();
  const data = useAsync(async () => {
    const rows = await api.adminListReports(filter);
    const authors = await api.profilesByIds(rows.map((r) => r.target_user_id).filter((x): x is string => !!x));
    return { rows, authors };
  }, [], user ? memUserKey(user.id, `admin-reports:${filter}`) : null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FilterToggle value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
        <button onClick={() => data.reload()} className="text-xs font-semibold text-wa-green">Refresh</button>
      </div>
      {data.loading && !data.data ? (
        <Spinner />
      ) : data.error ? (
        <ErrorNote message={data.error} />
      ) : data.data!.rows.length === 0 ? (
        <div className={`${panelCard} text-center py-10`}>
          <ShieldCheck className="w-10 h-10 text-wa-green mx-auto mb-2" />
          <p className={`text-sm font-medium ${bodyText}`}>{filter === 'open' ? 'All clear' : 'No reports yet'}</p>
          <p className={`text-xs mt-1 ${mutedText}`}>{filter === 'open' ? 'There are no open reports.' : 'Reports from users will appear here.'}</p>
        </div>
      ) : (
        data.data!.rows.map((r) => (
          <ReportCard key={r.id} report={r} author={r.target_user_id ? data.data!.authors[r.target_user_id] : undefined} onDone={data.reload} />
        ))
      )}
    </div>
  );
}
