import { useState } from 'react';
import { Flag, Loader2, CheckCircle2 } from 'lucide-react';
import Modal from '@/components/Modal';
import { ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { REPORT_REASONS, type ReportReason, type ReportTarget } from '@/lib/types';

type Props = { targetType: ReportTarget; targetId: string; onClose: () => void };

export default function ReportModal({ targetType, targetId, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!reason) return setError('Please choose a reason.');
    setBusy(true);
    setError(null);
    try {
      await api.createReport({ target_type: targetType, target_id: targetId, reason, details });
      setDone(true);
    } catch (e) {
      const err = e as { code?: string };
      setError(err.code === '23505' ? 'You have already reported this. Our team will review it.' : friendlyError(e));
    }
    setBusy(false);
  };

  return (
    <Modal title={`Report ${targetType}`} icon={Flag} onClose={onClose}>
      {done ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-10 h-10 text-wa-green mx-auto mb-3" />
          <p className={`text-sm font-semibold ${bodyText}`}>Thanks for letting us know</p>
          <p className={`text-xs mt-1.5 ${mutedText}`}>A moderator will review this. Your report is private.</p>
          <button onClick={onClose} className={`${ghostBtn} mt-4`}>Close</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={`text-xs ${mutedText}`}>Why are you reporting this {targetType}?</p>
          <div className="space-y-1.5">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm cursor-pointer border transition-colors ${
                  reason === r.value ? 'border-wa-green bg-wa-green/10' : 'border-wa-lightBorder dark:border-wa-darkBorder'
                } ${bodyText}`}
              >
                <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[#00a884]" />
                {r.label}
              </label>
            ))}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Add details (optional)"
            className={inputClass}
          />
          {error && <ErrorNote message={error} />}
          <button onClick={submit} disabled={busy} className={`${primaryBtn} w-full`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit report
          </button>
        </div>
      )}
    </Modal>
  );
}
