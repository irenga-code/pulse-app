import { useMemo, useState } from 'react';
import { Megaphone, Send, Loader2, Camera, Plus, Check, MessageSquareDot } from 'lucide-react';
import SectionHeader from '@/components/nav/SectionHeader';
import { ErrorNote, Field, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useChannels } from '@/hooks/useChannels';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';

const MAX = 2000;
const card = 'bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder p-4';

/** A channel for a business you run that has none yet (the database ties every channel to its owner). */
function CreateChannel({ ownerId, onCreated }: { ownerId: string; onCreated: () => void }) {
  const { show } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2 || name.trim().length > 60) return setError('Channel names are 2-60 characters.');
    setBusy(true);
    setError(null);
    try {
      await api.createChannel(ownerId, name, description);
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
        <input value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} placeholder="Updates, news, and announcements" className={inputClass} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={primaryBtn}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Create channel</button>
    </form>
  );
}

/** Business broadcast: write once and post to one or more of the channels you run; Quick-Snap a photo / video too. */
export default function BroadcastsTab() {
  const { user } = useAuth();
  const { show } = useToast();
  const { openQuickSnap } = useQuickSnap();
  const ch = useChannels();
  // ch.managed = the businesses you run; each can have one channel
  const channelOf = useMemo(() => new Map(ch.channels.map((c) => [c.venue_id, c])), [ch.channels]);
  const withoutChannel = ch.managed.filter((id) => !channelOf.has(id));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = ch.managed.map((id) => channelOf.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
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
    return <div className="flex flex-col h-full"><SectionHeader title="Business broadcast" camera={false} /><p className={`px-4 text-sm ${mutedText}`}>Sign in to broadcast to your channels.</p></div>;
  }

  return (
    <div className="flex flex-col pb-8">
      <SectionHeader title="Business broadcast" subtitle="One message to every follower of your channels" />
      <div className="px-4 md:px-6 space-y-4 max-w-2xl">
        {ch.loading ? (
          <p className={`text-sm ${mutedText}`}>Loading your channels…</p>
        ) : ch.managed.length === 0 ? (
          <div className={`${card} text-center py-10`}>
            <Megaphone className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
            <p className={`text-sm font-medium ${bodyText}`}>Broadcasts are for business channels</p>
            <p className={`text-xs mt-1 ${mutedText}`}>Once your account runs a business channel, you can send its followers one update from here.</p>
          </div>
        ) : (
          <>
            {ready.length > 0 && (
              <form onSubmit={blast} className={`${card} space-y-3`}>
                <p className={`text-sm font-semibold ${bodyText}`}>New broadcast</p>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={3} placeholder="Share an update with your followers…"
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
                    onClick={() => targets[0] && openQuickSnap({ destination: { kind: 'channel', channelId: targets[0].id, label: targets[0].name }, onSent: () => { void ch.reload(); } })}
                    className={`${ghostBtn} disabled:opacity-40`}>
                    <Camera className="w-4 h-4" />Snap
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              <p className={`text-xs font-semibold uppercase tracking-wide ${mutedText}`}>Your channels</p>
              {ready.map((c) => (
                <div key={c.id} className={`${card} flex items-center gap-3`}>
                  <MessageSquareDot className="w-11 h-11 p-2 text-wa-green flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold truncate ${bodyText}`}>{c.name}</span>
                    <span className={`block text-xs ${mutedText}`}>{c.follower_count} follower{c.follower_count === 1 ? '' : 's'}</span>
                  </span>
                </div>
              ))}
              {withoutChannel.map((id) => (
                <div key={id} className={card}>
                  <div className="flex items-center gap-3">
                    <MessageSquareDot className={`w-11 h-11 p-2 flex-shrink-0 ${mutedText}`} />
                    <span className={`flex-1 text-sm ${mutedText}`}>A business you run has no channel yet</span>
                    {creating !== id && (
                      <button onClick={() => setCreating(id)} className={`${ghostBtn} !px-3 !py-1.5 text-xs`}><Plus className="w-3.5 h-3.5" />Create channel</button>
                    )}
                  </div>
                  {creating === id && <CreateChannel ownerId={id} onCreated={() => { setCreating(null); void ch.reload(); }} />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
