import { useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, Send, Loader2, Camera, Plus, MessageSquareDot, ImagePlus, X, Users, Clock } from 'lucide-react';
import SectionHeader from '@/components/nav/SectionHeader';
import { ErrorNote, Field, inputClass, primaryBtn, ghostBtn, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useChannels } from '@/hooks/useChannels';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useQuickSnap } from '@/camera/QuickSnapContext';
import { useAsync } from '@/hooks/useAsync';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { formatDateTime, timeAgo } from '@/lib/time';
import { userKey } from '@/lib/cache';
import type { Channel } from '@/lib/types';

const MAX = 2000;
const MEDIA_MAX = 25 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
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

/**
 * Business broadcast: pick an audience (all your channel followers or one channel), write once with an optional photo /
 * video, and send; your recent broadcasts are listed underneath. A business without a channel is offered one.
 */
export default function BroadcastsTab() {
  const { user } = useAuth();
  const { show } = useToast();
  const { openQuickSnap } = useQuickSnap();
  const ch = useChannels();
  // ch.managed = the businesses you run; each can have one channel
  const channelOf = useMemo(() => new Map(ch.channels.map((c) => [c.venue_id, c])), [ch.channels]);
  const withoutChannel = ch.managed.filter((id) => !channelOf.has(id));
  const ready = useMemo(() => ch.managed.map((id) => channelOf.get(id)).filter((c): c is Channel => !!c), [ch.managed, channelOf]);
  const readyIds = ready.map((c) => c.id).join();
  const past = useAsync(() => (user ? api.myChannelPosts(user.id, ready.map((c) => c.id)) : Promise.resolve([])), [readyIds], user ? userKey(user.id, 'broadcasts') : null);
  const byId = useMemo(() => new Map(ready.map((c) => [c.id, c])), [ready]);

  const [audience, setAudience] = useState<'all' | string>('all');
  const [creating, setCreating] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<{ file: File; url: string; video: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);

  const targets = audience === 'all' ? ready : ready.filter((c) => c.id === audience);
  const reach = targets.reduce((n, c) => n + c.follower_count, 0);

  const pickMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!MEDIA_TYPES.includes(f.type)) return setError('Choose a JPG, PNG or WebP photo, or an MP4 / WebM / MOV video.');
    if (f.size > MEDIA_MAX) return setError('That file is too large (max 25 MB).');
    setError(null);
    setMedia({ file: f, url: URL.createObjectURL(f), video: f.type.startsWith('video/') });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if ((!body && !media) || targets.length === 0 || !user) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    try {
      // upload once, then post the same file to every channel
      const ext = media ? (media.file.type.split('/')[1] === 'quicktime' ? 'mov' : media.file.type.split('/')[1] === 'jpeg' ? 'jpg' : media.file.type.split('/')[1]) : '';
      const url = media ? await api.uploadPostMedia(user.id, media.file, ext) : null;
      const m = url && media ? { media_url: url, media_type: media.video ? 'video' as const : 'image' as const } : null;
      for (const c of targets) {
        try { await api.postChannelMessage(c.id, { body, media: m }); } catch (err) { failed.push(`${c.name}: ${friendlyError(err)}`); }
      }
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (failed.length) setError(failed.join(' · '));
    if (failed.length < targets.length) {
      const sent = targets.length - failed.length;
      show(`Broadcast sent to ${sent} channel${sent === 1 ? '' : 's'}`);
      setText('');
      setMedia(null);
      void ch.reload();
      void past.reload();
    }
  };

  const createButton = (
    <button type="button" onClick={() => setCreating(withoutChannel[0])} disabled={withoutChannel.length === 0}
      className={`${primaryBtn} w-full`}>
      <Plus className="w-4 h-4" />Create Business Channel
    </button>
  );

  if (!user) {
    return <div className="flex flex-col h-full"><SectionHeader title="Business broadcast" camera={false} /><p className={`px-4 text-sm ${mutedText}`}>Sign in to broadcast to your channels.</p></div>;
  }

  return (
    <div className="flex flex-col pb-8">
      <SectionHeader title="Business broadcast" subtitle="One message to every follower of your channels" />
      <div className="px-4 md:px-6 space-y-4 max-w-2xl">
        {ch.loading ? (
          <p className={`text-sm ${mutedText}`}>Loading your channels…</p>
        ) : ready.length === 0 ? (
          <div className={`${card} text-center py-8`}>
            <Megaphone className="w-12 h-12 text-wa-quiet mx-auto mb-3" />
            <p className={`text-sm font-medium ${bodyText}`}>You don't have a business channel yet</p>
            <p className={`text-xs mt-1 mb-4 ${mutedText}`}>
              {withoutChannel.length > 0
                ? 'Create a channel for your business, then send updates to everyone who follows it.'
                : 'Channels belong to a business. Once your account is linked to one, you can create its channel here.'}
            </p>
            {creating ? <div className="text-left"><CreateChannel ownerId={creating} onCreated={() => { setCreating(null); void ch.reload(); }} /></div> : createButton}
          </div>
        ) : (
          <>
            <form onSubmit={send} className={`${card} space-y-3`}>
              <label className="block">
                <span className={`flex items-center gap-1.5 text-xs font-semibold mb-1.5 ${mutedText}`}><Users className="w-3.5 h-3.5" />Send to</span>
                <select value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Audience" className={`${inputClass} cursor-pointer`}>
                  <option value="all">All channel followers ({ready.reduce((n, c) => n + c.follower_count, 0)})</option>
                  {ready.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.follower_count} follower{c.follower_count === 1 ? '' : 's'}</option>)}
                </select>
              </label>

              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} rows={4} placeholder="Share an update with your followers…"
                aria-label="Broadcast message" className={`${inputClass} resize-none`} />
              {media && (
                <div className="relative w-32 aspect-square rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder">
                  {media.video ? <video src={media.url} muted className="w-full h-full object-cover" /> : <img src={media.url} alt="Attached" className="w-full h-full object-cover" />}
                  <button type="button" onClick={() => setMedia(null)} aria-label="Remove attachment" className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"><X className="w-4 h-4" /></button>
                </div>
              )}
              <input ref={fileRef} type="file" accept={MEDIA_TYPES.join(',')} onChange={pickMedia} className="hidden" aria-label="Photo or video file" />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className={`${ghostBtn} !px-3`} aria-label="Attach photo or video"><ImagePlus className="w-4 h-4" />Photo / video</button>
                <button type="button" disabled={targets.length !== 1} title={targets.length === 1 ? 'Open the camera' : 'Pick one channel for a snap'}
                  onClick={() => targets[0] && openQuickSnap({ destination: { kind: 'channel', channelId: targets[0].id, label: targets[0].name }, onSent: () => { void ch.reload(); void past.reload(); } })}
                  className={`${ghostBtn} !px-3 disabled:opacity-40`} aria-label="Quick-Snap"><Camera className="w-4 h-4" /></button>
                <span className={`ml-auto text-[11px] ${mutedText}`}>{text.length}/{MAX}</span>
              </div>
              {error && <ErrorNote message={error} />}
              <button type="submit" disabled={busy || (!text.trim() && !media)} className={`${primaryBtn} w-full !py-3 text-base`}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Send Broadcast
              </button>
              <p className={`text-[11px] text-center ${mutedText}`}>
                Goes to {targets.length} channel{targets.length === 1 ? '' : 's'} · {reach} follower{reach === 1 ? '' : 's'}
              </p>
            </form>

            {withoutChannel.length > 0 && (
              <div className={card}>
                <p className={`text-sm mb-3 ${mutedText}`}>{withoutChannel.length === 1 ? 'A business you run has no channel yet.' : `${withoutChannel.length} businesses you run have no channel yet.`}</p>
                {creating ? <CreateChannel ownerId={creating} onCreated={() => { setCreating(null); void ch.reload(); }} /> : createButton}
              </div>
            )}

            <section aria-label="Past broadcasts" className="space-y-2">
              <h2 className={`text-xs font-semibold uppercase tracking-wide pt-2 ${mutedText}`}>Past broadcasts</h2>
              {past.loading && !past.data ? (
                <p className={`text-sm ${mutedText}`}>Loading…</p>
              ) : (past.data ?? []).length === 0 ? (
                <p className={`text-sm ${mutedText}`}>Nothing sent yet. Your broadcasts will show up here.</p>
              ) : (
                (past.data ?? []).map((m) => {
                  const c = byId.get(m.channel_id);
                  const n = c?.follower_count ?? 0;
                  return (
                    <article key={m.id} className={`${card} flex gap-3`}>
                      {m.media_url && (
                        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-black">
                          {m.media_type === 'video' ? <video src={m.media_url} muted preload="metadata" className="w-full h-full object-cover" /> : <img src={m.media_url} alt="" loading="lazy" className="w-full h-full object-cover" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <MessageSquareDot className="w-4 h-4 text-wa-green flex-shrink-0" />
                          <span className={`text-sm font-semibold truncate ${bodyText}`}>{c?.name ?? 'Channel'}</span>
                          <time dateTime={m.created_at} title={formatDateTime(m.created_at)} className={`ml-auto flex items-center gap-1 text-[11px] flex-shrink-0 ${mutedText}`}>
                            <Clock className="w-3 h-3" />{timeAgo(m.created_at)}
                          </time>
                        </div>
                        <p className={`text-sm mt-1 line-clamp-2 break-words ${bodyText}`}>{m.body ? <EmojiText text={m.body} /> : m.media_type === 'video' ? 'Video' : 'Photo'}</p>
                        <p className={`flex items-center gap-1 text-xs mt-1.5 ${mutedText}`}>
                          <Users className="w-3.5 h-3.5" />Sent to {n} follower{n === 1 ? '' : 's'}
                        </p>
                      </div>
                    </article>
                  );
                })
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
