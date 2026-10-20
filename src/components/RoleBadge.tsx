import { BadgeCheck, Mic2, Store, ShieldCheck } from 'lucide-react';
import type { AccountType } from '@/lib/types';

type Props = { accountType?: AccountType; verified?: boolean; admin?: boolean; official?: boolean };

const pill = 'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none';

/** Small status pills next to a name. */
export default function RoleBadge({ accountType, verified, admin, official }: Props) {
  return (
    <>
      {admin && (
        <span className={`${pill} bg-wa-live/15 text-wa-live`}><ShieldCheck className="w-3 h-3" />Admin</span>
      )}
      {official && (
        <span className={`${pill} bg-wa-green/15 text-wa-green`}><BadgeCheck className="w-3 h-3" />Official</span>
      )}
      {!official && accountType === 'host' && (
        <span className={`${pill} bg-blue-500/15 text-blue-400`}><Mic2 className="w-3 h-3" />Host</span>
      )}
      {!official && accountType === 'venue' && (
        <span className={`${pill} bg-wa-busy/15 text-wa-busy`}><Store className="w-3 h-3" />Venue</span>
      )}
      {verified && !official && accountType === 'user' && (
        <span className={`${pill} bg-wa-green/15 text-wa-green`}><BadgeCheck className="w-3 h-3" />Verified</span>
      )}
    </>
  );
}
