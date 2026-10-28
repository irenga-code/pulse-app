import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, CreditCard, Globe, ImagePlus, Info, MessageCircle, MoreHorizontal, ThumbsUp, X } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Modal from '@/components/Modal';
import { mutedText, bodyText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

/** Daily budget in US dollars, like WhatsApp Business's ad flow outside the user's own currency setup. */
const BUDGET_MIN = 1;
const BUDGET_MAX = 100;
const DESCRIPTION_MAX = 500;
const DURATIONS = [{ days: 1, label: '1 day' }, { days: 3, label: '3 days' }, { days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 0, label: 'Run until paused' }];
const AGES = [18, 21, 25, 30, 35, 40, 45, 50, 55, 60, 65];
const GENDERS = ['All', 'Men', 'Women'] as const;
const SPECIAL = ['Credit', 'Employment', 'Housing', 'Social issues, elections or politics'] as const;
type Placement = 'facebook' | 'instagram';
const PLACEMENTS: { id: Placement; label: string; hint: string }[] = [
  { id: 'facebook', label: 'Facebook', hint: 'Feed, Stories and Marketplace' },
  { id: 'instagram', label: 'Instagram', hint: 'Feed, Stories and Explore' },
];

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

type Media = { url: string; video: boolean };

/** A feed-style sponsored post as it would look on the chosen app; the button opens a WhatsApp chat. */
function AdPreview({ placement, name, avatar, text, media, story = false }: {
  placement: Placement; name: string; avatar: string | null; text: string; media: Media | null; story?: boolean;
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
  if (story) {
    return (
      <div className="relative aspect-[9/16] w-full rounded-xl overflow-hidden bg-black text-white">
        {visual}
        <div className="absolute inset-x-0 top-0 p-3 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent">
          <Avatar name={name} url={avatar} size={28} />
          <span className="text-xs font-semibold truncate">{name}</span>
          <span className="text-[10px] opacity-80">Sponsored</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
          <p className="text-xs line-clamp-2 mb-2">{shown}</p>
          <span className="flex items-center justify-center gap-1.5 rounded-full bg-white text-black text-xs font-semibold py-2"><MessageCircle className="w-3.5 h-3.5" />Send message</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder bg-white dark:bg-[#1c1e21] text-[#050505] dark:text-[#e4e6eb]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar name={name} url={avatar} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold truncate">{name}</span>
          <span className="flex items-center gap-1 text-[11px] opacity-60">Sponsored{placement === 'facebook' && <> · <Globe className="w-3 h-3" /></>}</span>
        </span>
        <MoreHorizontal className="w-4 h-4 opacity-60" />
      </div>
      {placement === 'facebook' && <p className="px-3 pb-2 text-[13px] whitespace-pre-wrap break-words line-clamp-4">{shown}</p>}
      <div className="aspect-square w-full">{visual}</div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#f0f2f5] dark:bg-[#242526]">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase opacity-60">WhatsApp</span>
          <span className="block text-[13px] font-semibold truncate">Chat with {name}</span>
        </span>
        <span className="flex items-center gap-1 rounded-md bg-[#e4e6eb] dark:bg-[#3a3b3c] px-3 py-1.5 text-xs font-semibold"><MessageCircle className="w-3.5 h-3.5" />Send message</span>
      </div>
      {placement === 'instagram'
        ? <p className="px-3 py-2 text-[13px] break-words line-clamp-3"><span className="font-semibold">{name}</span> {shown}</p>
        : <div className="flex items-center justify-around px-3 py-1.5 text-xs font-semibold opacity-60 border-t border-black/5 dark:border-white/10"><span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" />Like</span><span>Comment</span><span>Share</span></div>}
    </div>
  );
}

/**
 * Business tools > Advertise > Create new ad: settings on the left, a live, sticky preview on the right (stacked on
 * phones). Pulse has no ad or payments backend yet, so publishing and payment methods are clearly marked as not
 * available; nothing here is sent anywhere.
 */
export default function CreateAdView({ onBack }: { onBack: () => void }) {
  const { profile } = useAuth();
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
  const [placements, setPlacements] = useState<Record<Placement, boolean>>({ facebook: true, instagram: true });
  const [budget, setBudget] = useState(3);
  const [days, setDays] = useState(7);
  const [previewOn, setPreviewOn] = useState<Placement>('facebook');
  const [seeAll, setSeeAll] = useState(false);

  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);
  const chosen = PLACEMENTS.filter((p) => placements[p.id]).map((p) => p.id);
  // the preview follows the placements: switching one off moves it to the other
  const shownOn = chosen.includes(previewOn) ? previewOn : chosen[0] ?? 'facebook';
  const name = profile?.display_name ?? 'Your business';
  const avatar = profile?.avatar_url ?? null;

  const pickMedia = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) return show('Choose a photo or a video.', 'error');
    setMedia({ url: URL.createObjectURL(f), video: f.type.startsWith('video/') });
  };
  const togglePlacement = (id: Placement, on: boolean) => {
    if (!on && chosen.length === 1) return show('Keep at least one placement.');
    setPlacements((p) => ({ ...p, [id]: on }));
  };
  const pct = ((budget - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100;
  const total = days ? `$${(budget * days).toLocaleString()} total over ${days} day${days === 1 ? '' : 's'}` : `$${budget} a day until you pause it`;

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

            <Card title="Placements" subtitle="Where your ad can appear.">
              {PLACEMENTS.map((p) => <Tick key={p.id} checked={placements[p.id]} onChange={(on) => togglePlacement(p.id, on)} label={p.label} hint={p.hint} />)}
            </Card>

            <Card title="Daily budget">
              <div className="flex items-baseline justify-between">
                <span className={`text-2xl font-semibold ${bodyText}`}>${budget}<span className={`text-sm font-normal ${mutedText}`}> / day</span></span>
                <span className={`text-xs ${mutedText}`}>USD</span>
              </div>
              <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Daily budget"
                className="ad-slider w-full mt-3" style={{ background: `linear-gradient(to right, rgb(var(--wa-green)) ${pct}%, rgb(var(--slider-track)) ${pct}%)` }} />
              <div className={`flex justify-between text-xs mt-1 ${mutedText}`}><span>${BUDGET_MIN}</span><span>${BUDGET_MAX}</span></div>
            </Card>

            <Card title="Duration">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Duration">
                {DURATIONS.map((d) => <button key={d.days} type="button" role="radio" aria-checked={days === d.days} onClick={() => setDays(d.days)} className={pill(days === d.days)}>{d.label}</button>)}
              </div>
              <p className={`text-sm mt-3 ${mutedText}`}>{total}</p>
            </Card>

            <Card title="Payment details">
              <div className="flex items-center justify-between text-sm py-1">
                <span className={mutedText}>Total budget</span>
                <span className={`font-semibold ${bodyText}`}>{days ? `$${(budget * days).toLocaleString()}` : `$${budget} / day`}</span>
              </div>
              <button type="button" onClick={() => show('Payment methods are coming soon to Pulse')}
                className="mt-3 w-full flex items-center gap-3 rounded-xl border border-wa-lightBorder dark:border-wa-darkBorder px-4 py-3 text-left hover:bg-wa-lightSecondary dark:hover:bg-white/5 transition-colors">
                <CreditCard className="w-5 h-5 text-wa-green" />
                <span className="text-sm font-semibold text-wa-green flex-1">Add a payment method</span>
              </button>
              <p className={`flex items-start gap-1.5 text-xs mt-3 ${mutedText}`}><Info className="w-3.5 h-3.5 mt-px flex-shrink-0" />Publishing ads isn't available on Pulse yet. You can set up and preview your ad here.</p>
            </Card>
          </div>

          {/* live preview, pinned while the settings scroll */}
          <aside className="lg:sticky lg:top-6 self-start min-w-0">
            <div className={card}>
              <div className="flex items-center justify-between">
                <h2 className={`text-base font-semibold ${bodyText}`}>Ad preview</h2>
                <button onClick={() => setSeeAll(true)} className="rounded-full px-3 py-1 text-sm font-semibold text-wa-green hover:bg-wa-green/10 transition-colors">See all</button>
              </div>
              {chosen.length > 1 && (
                <div className="flex gap-1 mt-3 p-1 rounded-full bg-wa-lightSecondary dark:bg-wa-dark" role="tablist" aria-label="Preview placement">
                  {chosen.map((p) => (
                    <button key={p} role="tab" aria-selected={shownOn === p} onClick={() => setPreviewOn(p)}
                      className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors ${shownOn === p ? 'bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-sm text-wa-green' : mutedText}`}>
                      {p === 'facebook' ? 'Facebook' : 'Instagram'}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3"><AdPreview placement={shownOn} name={name} avatar={avatar} text={text} media={media} /></div>
            </div>
            <button type="button" disabled title="Add a payment method to publish"
              className="mt-4 w-full rounded-full bg-wa-green py-3 text-sm font-semibold text-white disabled:opacity-40">
              Publish ad
            </button>
          </aside>
        </div>
      </div>

      {seeAll && (
        <Modal title="All placements" onClose={() => setSeeAll(false)}>
          <div className="grid gap-5 sm:grid-cols-2">
            {chosen.flatMap((p) => [false, true].map((story) => (
              <figure key={`${p}-${story}`} className="min-w-0">
                <figcaption className={`text-xs font-semibold mb-1.5 ${mutedText}`}>{p === 'facebook' ? 'Facebook' : 'Instagram'} {story ? 'Stories' : 'Feed'}</figcaption>
                <AdPreview placement={p} name={name} avatar={avatar} text={text} media={media} story={story} />
              </figure>
            )))}
          </div>
        </Modal>
      )}
    </div>
  );
}
