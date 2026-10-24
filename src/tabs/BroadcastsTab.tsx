import { useMemo, useState } from 'react';
import { Megaphone, Send, Loader2, Camera, Plus, Check, Store } from 'lucide-react';
import VenueLogo from '@/components/VenueLogo';
import SectionHeader from '@/components/nav/SectionHeader';
import { ErrorNote, Field, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useChannels } from '@/hooks/useChannels';
import { useVenues } from '@/hooks/useVenues';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import type { Venue } from '@/lib/types';

const MAX = 2000;
const card = 'bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder p-4';

function CreateChannel({ venue, onCreated }: { venue: Venue; onCreated: () => void }) {
  const { show } = useToast();
  const [name, setName] = useState(venue.name);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || name.trim().length > 60) return setError('Channel names are 2-60 characters.');
    setBusy(true);
    setError(null);
    try {
      await api.createChannel(venue.id, name, description);
      show(`${name.trim()} channel created`);
      onCreated();
    } catch (err) {
      setError(isMissingSchema(err) ? 'Channels need the latest database update (migration 15).' : friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="space-y-2.5 mt-3" noValidate>
      <Field label="Channel name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} /></Field>
      <Field label="About" hint={`${description.length}/300`}>
        <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} placeholder="Line-ups, drops and offers from us" className={inputClass} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={primaryBtn}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Create channel</button>
    </form>
  );
}

/** Broadcast Blasts: venue staff write once and post to one or more of their venue channels; Quick-Snap a photo / video too. */
export default function BroadcastsTab() {
  const { user, isAdmin } = useAuth();
  const { show } = useToast();
  const { openQuickSnap } = useQuickSnap();
  const ch = useChannels();
  const { venues } = useVenues({ orderBy: 'name' });
  const mine = useMemo(() => venues.filter((v) => ch.managed.includes(v.id)), [venues, ch.managed]);
  const channelOf = useMemo(() => new Map(ch.channels.map((c) => [c.venue_id, c])), [ch.channels]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = mine.map((v) => channelOf.get(v.id)).filter((c): c is NonNullable<typeof c> => !!c);
  // nothing ticked = every channel you run
  const targets = picked.size > 0 ? ready.filter((c) => picked.has(c.id)) : ready;

  const blast = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || targets.length === 0) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const c of targets) {
      try { await api.postChannelMessage(c.id, { body }); } catch (err) { failed.push(`${c.name}: ${friendlyError(err)}`); }
    }
    setBusy(false);
    if (failed.length) setError(failed.join(' · '));
    if (failed.length < targets.length) {
      show(`Broadcast sent to ${targets.length - failed.length} channel${targets.length - failed.length === 1 ? '' : 's'}`);
      setText('');
      void ch.reload();
    }
  };

  if (!user) {
    return <div className="flex flex-col h-full"><SectionHeader title="Broadcast blasts" camera={false} /><p className={`px-4 text-sm ${mutedText}`}>Sign in to broadcast to your venue channels.</p></div>;
  }

  return (
    <div className="flex flex-col pb-8">
      <SectionHeader title="Broadcast blasts" subtitle="One message to every follower of your venue channels" />
      <div className="px-4 md:px-6 space-y-4 max-w-2xl">
        {ch.loading ? (
          <p className={`text-sm ${mutedText}`}>Loading your venues…</p>
        ) : mine.length === 0 ? (
          <div className={`${card} text-center py-10`}>
            <Megaphone className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
            <p className={`text-sm font-medium ${bodyText}`}>Broadcasts are for venue teams</p>
            <p className={`text-xs mt-1 ${mutedText}`}>
              {isAdmin ? 'Link yourself to a venue in Admin > Venue staff to broadcast for it.' : 'Register your club or request verification as its manager or host from your profile, then broadcast to its followers here.'}
            </p>
          </div>
        ) : (
          <>
            {ready.length > 0 && (
              <form onSubmit={blast} className={`${card} space-y-3`}>
                <p className={`text-sm font-semibold ${bodyText}`}>New broadcast</p>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={3} placeholder="Doors open at 10. First 50 in get a free shot 🔥"
                  aria-label="Broadcast message" className={`${inputClass} resize-none`} />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Send to channels">
                  {ready.map((c) => {
                    const on = picked.size === 0 || picked.has(c.id);
                    return (
                      <button key={c.id} type="button" aria-pressed={on}
                        onClick={() => setPicked((s) => {
                          const base = s.size === 0 ? new Set(ready.map((r) => r.id)) : new Set(s);
                          if (base.has(c.id)) base.delete(c.id); else base.add(c.id);
                          return base.size === ready.length ? new Set() : base;
                        })}
                        className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold border ${on ? 'bg-wa-green/15 text-wa-green border-wa-green/40' : `border-wa-lightBorder dark:border-wa-darkBorder ${mutedText}`}`}>
                        {on && <Check className="w-3.5 h-3.5" />}{c.name} · {c.follower_count}
                      </button>
                    );
                  })}
                </div>
                {error && <ErrorNote message={error} />}
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={busy || !text.trim() || targets.length === 0} className={primaryBtn}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send to {targets.length} channel{targets.length === 1 ? '' : 's'}
                  </button>
                  <button type="button" disabled={targets.length !== 1} title={targets.length === 1 ? undefined : 'Pick one channel for a snap'}
                    onClick={() => targets[0] && openQuickSnap({ destination: { kind: 'channel', channelId: targets[0].id, label: targets[0].name }, initialVenueId: targets[0].venue_id, onSent: () => { void ch.reload(); } })}
                    className={`${ghostBtn} disabled:opacity-40`}>
                    <Camera className="w-4 h-4" />Snap
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              <p className={`text-xs font-semibold uppercase tracking-wide ${mutedText}`}>Your venues</p>
              {mine.map((v) => {
                const c = channelOf.get(v.id);
                return (
                  <div key={v.id} className={card}>
                    <div className="flex items-center gap-3">
                      <VenueLogo venue={v} size={44} fallback />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold truncate ${bodyText}`}>{v.name}</span>
                        <span className={`block text-xs ${mutedText}`}>{c ? `${c.name} · ${c.follower_count} follower${c.follower_count === 1 ? '' : 's'}` : 'No channel yet'}</span>
                      </span>
                      {!c && creating !== v.id && (
                        <button onClick={() => setCreating(v.id)} className={`${ghostBtn} !px-3 !py-1.5 text-xs`}><Plus className="w-3.5 h-3.5" />Create channel</button>
                      )}
                      {c && <Store className={`w-4 h-4 ${mutedText}`} aria-hidden="true" />}
                    </div>
                    {!c && creating === v.id && <CreateChannel venue={v} onCreated={() => { setCreating(null); void ch.reload(); }} />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
