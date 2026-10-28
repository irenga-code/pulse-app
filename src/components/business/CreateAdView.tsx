import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Check, ImagePlus, Loader2, MessageCircle, MessageSquareDot, MoreHorizontal, Search, Store, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Modal from '@/components/Modal';
import { ErrorNote, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const DESCRIPTION_MAX = 500;
/** Promotions are free; they only differ in how long they run. 0 = continuous (until you pause it). */
const DURATIONS = [{ days: 1, label: '1 day' }, { days: 3, label: '3 days' }, { days: 7, label: '7 days' }, { days: 0, label: 'Continuous' }];
const MEDIA_MAX = 25 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
const MIGRATION_NOTE = 'Campaigns need the latest database update (migration 22).';
const AGES = [18, 21, 25, 30, 35, 40, 45, 50, 55, 60, 65];
const GENDERS = ['All', 'Men', 'Women'] as const;
const SPECIAL = ['Credit', 'Employment', 'Housing', 'Social issues, elections or politics'] as const;
type Placement = 'feed' | 'status' | 'directory';
const PLACEMENTS: { id: Placement; label: string; hint: string }[] = [
  { id: 'feed', label: 'Pulse Feed', hint: 'Main feed, timeline & sponsored posts' },
  { id: 'status', label: 'Pulse Status', hint: '24-hour status updates & stories' },
  { id: 'directory', label: 'Pulse Directory & Channels', hint: 'Promoted channels and business search' },
];
const PLACEMENT_LABEL: Record<Placement, string> = { feed: 'Pulse Feed', status: 'Pulse Status', directory: 'Directory & Channels' };
/** The live preview switches between these two; the directory listing shows under See all. */
const TABBED: Placement[] = ['feed', 'status'];

const card = 'bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl border border-wa-lightBorder dark:border-wa-darkBorder p-5';
const pill = (on: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${on ? 'border-wa-green bg-wa-green/10 text-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder hover:bg-wa-lightSecondary dark:hover:bg-white/5 ${bodyText}`}`;
const selectClass = `rounded-lg border border-wa-lightBorder dark:border-wa-darkBorder bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-wa-green ${bodyText}`;

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <h2 className={`text-base font-semibold ${bodyText}`}>{title}</h2>
      {subtitle && <p className={`text-sm mt-0.5 ${mutedText}`}>{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A green tick box with a label, WhatsApp-style. */
function Tick({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-wa-green/50 ${checked ? 'bg-wa-green border-wa-green' : 'border-wa-lightTextSecondary/60 dark:border-wa-darkTextSecondary/60'}`}>
        {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </span>
      <span>
        <span className={`block text-sm ${bodyText}`}>{label}</span>
        {hint && <span className={`block text-xs ${mutedText}`}>{hint}</span>}
      </span>
    </label>
  );
}

type Media = { url: string; video: boolean; file?: File };

/** The ad as it would appear in each Pulse placement; every version's button opens a chat with the business. */
function AdPreview({ placement, name, avatar, text, media }: {
  placement: Placement; name: string; avatar: string | null; text: string; media: Media | null;
}) {
  const shown = text.trim() || 'Your ad description appears here.';
  const visual = media ? (
    media.video
      ? <video src={media.url} muted loop autoPlay playsInline className="w-full h-full object-cover" />
      : <img src={media.url} alt="" className="w-full h-full object-cover" />
  ) : (
    <div className={`w-full h-full flex flex-col items-center justify-center gap-1 bg-wa-lightSecondary dark:bg-wa-dark ${mutedText}`}>
      <ImagePlus className="w-8 h-8" /><span className="text-xs">Your photo or video</span>
    </div>
  );
  const messageBtn = 'flex items-center justify-center gap-1.5 rounded-full bg-wa-green text-white text-xs font-semibold';

  if (placement === 'status') {
    // a 24 h status in the status viewer: progress bars on top, the message button at the bottom
    return (
      <div className="relative aspect-[9/16] w-full rounded-xl overflow-hidden bg-black text-white">
        {visual}
        <div className="absolute inset-x-0 top-0 p-3 space-y-2 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex gap-1" aria-hidden="true">
            <span className="h-0.5 flex-1 rounded-full bg-white" /><span className="h-0.5 flex-1 rounded-full bg-white/40" />
          </div>
          <div className="flex items-center gap-2">
            <Avatar name={name} url={avatar} size={28} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold truncate">{name}</span>
              <span className="block text-[10px] opacity-80">Sponsored</span>
            </span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/75 to-transparent">
          <p className="text-xs line-clamp-2 mb-2">{shown}</p>
          <span className={`${messageBtn} py-2`}><MessageCircle className="w-3.5 h-3.5" />Send message</span>
        </div>
      </div>
    );
  }

  if (placement === 'directory') {
    // business search with the promoted business on top, then its promoted channel
    return (
      <div className="rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
        <div className="p-3">
          <div className={`flex items-center gap-2 rounded-full bg-wa-lightSecondary dark:bg-wa-darkSecondary px-3 py-2 text-xs ${mutedText}`}>
            <Search className="w-3.5 h-3.5" />Search businesses and channels
          </div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5 border-t border-wa-lightBorder dark:border-wa-darkBorder">
          <Avatar name={name} url={avatar} size={40} />
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1 text-sm font-semibold truncate ${bodyText}`}>{name}<Store className="w-3.5 h-3.5 text-wa-green flex-shrink-0" /></span>
            <span className={`block text-xs truncate ${mutedText}`}>Sponsored · {shown}</span>
          </span>
          <span className={`${messageBtn} px-3 py-1.5`}>Message</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5 border-t border-wa-lightBorder dark:border-wa-darkBorder">
          <MessageSquareDot className="w-10 h-10 p-2 text-wa-green flex-shrink-0" />
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-semibold truncate ${bodyText}`}>{name} channel</span>
            <span className={`block text-xs ${mutedText}`}>Promoted channel</span>
          </span>
          <span className="rounded-full border border-wa-green/50 px-3 py-1.5 text-xs font-semibold text-wa-green">Follow</span>
        </div>
      </div>
    );
  }

  // a sponsored post in the main feed, laid out like Pulse's own post cards
  return (
    <div className="rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkSecondary">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar name={name} url={avatar} size={32} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-semibold truncate ${bodyText}`}>{name}</span>
          <span className={`block text-[11px] ${mutedText}`}>Sponsored</span>
        </span>
        <MoreHorizontal className={`w-4 h-4 ${mutedText}`} />
      </div>
      <p className={`px-3 pb-2 text-[13px] whitespace-pre-wrap break-words line-clamp-4 ${bodyText}`}>{shown}</p>
      <div className="aspect-square w-full">{visual}</div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className={`block text-[11px] uppercase ${mutedText}`}>Pulse chat</span>
          <span className={`block text-[13px] font-semibold truncate ${bodyText}`}>Chat with {name}</span>
        </span>
        <span className={`${messageBtn} px-3 py-1.5`}><MessageCircle className="w-3.5 h-3.5" />Send message</span>
      </div>
    </div>
  );
}

/**
 * Business tools > Advertise > Create new ad: settings on the left, a live, sticky preview on the right (stacked on
 * phones). Promotions are free and native to Pulse: Publish Campaign uploads the media and saves the campaign
 * (promotions, migration 22) as active straight away; the server works out when it ends.
 */
export default function CreateAdView({ onBack }: { onBack: () => void }) {
  const { user, profile } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [text, setText] = useState('');
  const [suggested, setSuggested] = useState(true);
  const [locations, setLocations] = useState('Uganda');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<(typeof GENDERS)[number]>('All');
  const [special, setSpecial] = useState(false);
  const [specialKinds, setSpecialKinds] = useState<string[]>([]);
  const [placements, setPlacements] = useState<Record<Placement, boolean>>({ feed: true, status: true, directory: true });
  const [days, setDays] = useState(7);
  const [previewOn, setPreviewOn] = useState<Placement>('feed');
  const [seeAll, setSeeAll] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);
  const chosen = PLACEMENTS.filter((p) => placements[p.id]).map((p) => p.id);
  // the preview follows the placements: switching Feed or Status off moves it to the other (Directory when neither is on)
  const tabs = TABBED.filter((p) => chosen.includes(p));
  const shownOn = tabs.includes(previewOn) ? previewOn : tabs[0] ?? 'directory';
  const name = profile?.display_name ?? 'Your business';
  const avatar = profile?.avatar_url ?? null;

  const pickMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!MEDIA_TYPES.includes(f.type)) return show('Choose a JPG, PNG or WebP photo, or an MP4 / WebM / MOV video.', 'error');
    if (f.size > MEDIA_MAX) return show('That file is too large (max 25 MB).', 'error');
    setMedia({ url: URL.createObjectURL(f), video: f.type.startsWith('video/'), file: f });
  };
  const togglePlacement = (id: Placement, on: boolean) => {
    if (!on && chosen.length === 1) return show('Keep at least one placement.');
    setPlacements((p) => ({ ...p, [id]: on }));
  };
  const endsOn = days
    ? new Date(Date.now() + days * 86_400_000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;
  const audienceLabel = suggested
    ? 'Suggested audience: people 18+ near your business'
    : `${locations.trim() || 'Anywhere'} · ages ${ageMin}–${ageMax === 65 ? '65+' : ageMax} · ${gender === 'All' ? 'everyone' : gender.toLowerCase()}`;
  const canPublish = !!user && (!!text.trim() || !!media) && !publishing;

  const publish = async () => {
    if (!user || !canPublish) return;
    setPublishing(true);
    setError(null);
    try {
      let mediaUrl: string | null = null;
      if (media?.file) {
        const sub = media.file.type.split('/')[1];
        mediaUrl = await api.uploadPostMedia(user.id, media.file, sub === 'jpeg' ? 'jpg' : sub === 'quicktime' ? 'mov' : sub);
      }
      await api.createPromotion({
        description: text.trim() || null,
        media_url: mediaUrl,
        media_type: mediaUrl ? (media!.video ? 'video' : 'image') : null,
        placements: chosen,
        audience: suggested ? { suggested: true } : { suggested: false, locations: locations.trim(), ageMin, ageMax, gender },
        special_categories: special ? specialKinds : [],
        duration_days: days || null,
      });
      show(days ? `Campaign published. It runs until ${endsOn}.` : 'Campaign published. It runs until you pause it.');
      onBack();
    } catch (err) {
      setError(isMissingSchema(err) ? MIGRATION_NOTE : friendlyError(err));
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-wa-lightBorder dark:border-wa-darkBorder bg-wa-lightPanel dark:bg-wa-darkPanel">
        <button onClick={onBack} aria-label="Back to Business tools" className="p-2 -ml-2 rounded-full hover:bg-wa-lightSecondary dark:hover:bg-white/10"><ArrowLeft className={`w-5 h-5 ${bodyText}`} /></button>
        <h1 className={`text-lg font-semibold flex-1 ${bodyText}`}>Create new ad</h1>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth overscroll-contain">
        <div className="grid gap-5 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_360px] max-w-6xl mx-auto">
          {/* settings */}
          <div className="space-y-4 min-w-0">
            <Card title="Ad creative" subtitle="Add a photo or video people will see in your ad.">
              <input ref={fileRef} type="file" accept="image/*,video/*" onChange={pickMedia} className="hidden" aria-label="Ad media file" />
              {media ? (
                <div className="relative w-40 aspect-square rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder">
                  {media.video ? <video src={media.url} muted className="w-full h-full object-cover" /> : <img src={media.url} alt="Ad media" className="w-full h-full object-cover" />}
                  <button onClick={() => setMedia(null)} aria-label="Remove media" className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-wa-lightBorder dark:border-wa-darkBorder hover:border-wa-green hover:bg-wa-green/5 transition-colors">
                  <ImagePlus className="w-8 h-8 text-wa-green" />
                  <span className="text-sm font-semibold text-wa-green">Add media</span>
                  <span className={`text-xs ${mutedText}`}>Photo or video</span>
                </button>
              )}
            </Card>

            <Card title="Description">
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, DESCRIPTION_MAX))} rows={4} placeholder="Tell people what you offer and why they should message you"
                aria-label="Ad description" className={`w-full resize-none rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder bg-transparent px-3.5 py-3 text-sm focus:outline-none focus:border-wa-green transition-colors ${bodyText}`} />
              <p className={`text-xs text-right mt-1 ${mutedText}`}>{text.length}/{DESCRIPTION_MAX}</p>
            </Card>

            <Card title="Audience" subtitle="Who should see your ad?">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Audience">
                <button type="button" role="radio" aria-checked={suggested} onClick={() => setSuggested(true)} className={pill(suggested)}>Suggested audience</button>
                <button type="button" role="radio" aria-checked={!suggested} onClick={() => setSuggested(false)} className={pill(!suggested)}>Create your own</button>
              </div>
              {suggested ? (
                <p className={`text-sm mt-3 ${mutedText}`}>People aged 18 and older near your business location, interested in what you offer.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className={`block text-xs font-semibold mb-1.5 ${mutedText}`}>Locations</span>
                    <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Countries, regions or cities" className={`${selectClass} w-full`} />
                  </label>
                  <div>
                    <span className={`block text-xs font-semibold mb-1.5 ${mutedText}`}>Age</span>
                    <div className="flex items-center gap-2">
                      <select value={ageMin} onChange={(e) => { const v = Number(e.target.value); setAgeMin(v); if (v > ageMax) setAgeMax(v); }} aria-label="Minimum age" className={selectClass}>
                        {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <span className={mutedText}>to</span>
                      <select value={ageMax} onChange={(e) => { const v = Number(e.target.value); setAgeMax(v); if (v < ageMin) setAgeMin(v); }} aria-label="Maximum age" className={selectClass}>
                        {AGES.map((a) => <option key={a} value={a}>{a === 65 ? '65+' : a}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <span className={`block text-xs font-semibold mb-1.5 ${mutedText}`}>Gender</span>
                    <div className="flex gap-2" role="radiogroup" aria-label="Gender">
                      {GENDERS.map((g) => <button key={g} type="button" role="radio" aria-checked={gender === g} onClick={() => setGender(g)} className={pill(gender === g)}>{g}</button>)}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Special requirements" subtitle="Ads about some topics have extra rules and fewer targeting options.">
              <Tick checked={special} onChange={setSpecial} label="My ad is about credit, employment, housing, social issues, elections or politics" />
              {special && (
                <div className="flex flex-wrap gap-2 mt-2 pl-8">
                  {SPECIAL.map((k) => {
                    const on = specialKinds.includes(k);
                    return <button key={k} type="button" aria-pressed={on} onClick={() => setSpecialKinds((ks) => (on ? ks.filter((x) => x !== k) : [...ks, k]))} className={pill(on)}>{k}</button>;
                  })}
                </div>
              )}
            </Card>

            <Card title="Placements" subtitle="Where your ad can appear in Pulse.">
              {PLACEMENTS.map((p) => <Tick key={p.id} checked={placements[p.id]} onChange={(on) => togglePlacement(p.id, on)} label={p.label} hint={p.hint} />)}
            </Card>

            <Card title="Campaign Reach & Duration" subtitle="Promotions on Pulse are free. Choose how long yours runs.">
              <dl className="space-y-2 text-sm">
                <div className="flex gap-3"><dt className={`w-24 flex-shrink-0 ${mutedText}`}>Shows in</dt><dd className={bodyText}>{chosen.map((p) => PLACEMENT_LABEL[p]).join(', ')}</dd></div>
                <div className="flex gap-3"><dt className={`w-24 flex-shrink-0 ${mutedText}`}>Audience</dt><dd className={bodyText}>{audienceLabel}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2 mt-4" role="radiogroup" aria-label="Duration">
                {DURATIONS.map((d) => <button key={d.days} type="button" role="radio" aria-checked={days === d.days} onClick={() => setDays(d.days)} className={pill(days === d.days)}>{d.label}</button>)}
              </div>
              <p className={`flex items-center gap-1.5 text-sm mt-3 ${mutedText}`}>
                <CalendarDays className="w-4 h-4 flex-shrink-0" />{endsOn ? `Starts when you publish and ends ${endsOn}` : 'Starts when you publish and runs until you pause it'}
              </p>
            </Card>
          </div>

          {/* live preview, pinned while the settings scroll */}
          <aside className="lg:sticky lg:top-6 self-start min-w-0">
            <div className={card}>
              <div className="flex items-center justify-between">
                <h2 className={`text-base font-semibold ${bodyText}`}>Ad preview</h2>
                <button onClick={() => setSeeAll(true)} className="rounded-full px-3 py-1 text-sm font-semibold text-wa-green hover:bg-wa-green/10 transition-colors">See all</button>
              </div>
              {tabs.length > 1 && (
                <div className="flex gap-1 mt-3 p-1 rounded-full bg-wa-lightSecondary dark:bg-wa-dark" role="tablist" aria-label="Preview placement">
                  {tabs.map((p) => (
                    <button key={p} role="tab" aria-selected={shownOn === p} onClick={() => setPreviewOn(p)}
                      className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors ${shownOn === p ? 'bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-sm text-wa-green' : mutedText}`}>
                      {PLACEMENT_LABEL[p]}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3"><AdPreview placement={shownOn} name={name} avatar={avatar} text={text} media={media} /></div>
            </div>
            {error && <div className="mt-4"><ErrorNote message={error} /></div>}
            <button type="button" onClick={() => void publish()} disabled={!canPublish} title={canPublish || publishing ? undefined : 'Add a description or media first'}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-full bg-wa-green py-3 text-sm font-semibold text-white hover:bg-wa-greenDark disabled:opacity-40 transition-colors">
              {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
              {publishing ? 'Publishing…' : 'Publish Campaign'}
            </button>
          </aside>
        </div>
      </div>

      {seeAll && (
        <Modal title="All placements" onClose={() => setSeeAll(false)}>
          <div className="grid gap-5 sm:grid-cols-2">
            {chosen.map((p) => (
              <figure key={p} className="min-w-0">
                <figcaption className={`text-xs font-semibold mb-1.5 ${mutedText}`}>{PLACEMENT_LABEL[p]}</figcaption>
                <AdPreview placement={p} name={name} avatar={avatar} text={text} media={media} />
              </figure>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
