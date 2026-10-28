import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignLeft, Briefcase, Camera, ChevronRight, Clock, ExternalLink, Link2, Loader2, Mail, MapPin, Phone, Radius, ShoppingBag, StickyNote, Store,
} from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import { ErrorNote, Spinner, mutedText, bodyText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError, isMissingSchema } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { BusinessHours, BusinessProfile, BusinessProfilePatch, WeekDay } from '@/lib/types';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX = 2 * 1024 * 1024;
const COVER_MAX = 5 * 1024 * 1024;
const STATUS_MAX = 139;
const MIGRATION_NOTE = 'Business details need the latest database update (migration 21). Your name and photo still save.';

/** WhatsApp Business's category list. */
const CATEGORIES = [
  'Automotive service', 'Beauty, cosmetic & personal care', 'Clothing (brand)', 'Education', 'Entertainment', 'Event planner',
  'Finance', 'Food & beverage', 'Grocery store', 'Hotel', 'Medical & health', 'Non-profit organization', 'Professional services',
  'Public & government service', 'Restaurant', 'Shopping & retail', 'Travel & transportation', 'Other business',
];
const DAYS: { id: WeekDay; label: string }[] = [
  { id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' }, { id: 'wed', label: 'Wednesday' }, { id: 'thu', label: 'Thursday' },
  { id: 'fri', label: 'Friday' }, { id: 'sat', label: 'Saturday' }, { id: 'sun', label: 'Sunday' },
];
type HoursMode = 'none' | BusinessHours['mode'];
const HOURS_MODES: { id: HoursMode; label: string }[] = [
  { id: 'none', label: 'Not set' }, { id: 'custom', label: 'Select hours' }, { id: 'always', label: 'Open 24 hours' }, { id: 'appointment', label: 'By appointment only' },
];
const defaultDays = (): BusinessHours['days'] =>
  Object.fromEntries(DAYS.map((d) => [d.id, { open: d.id !== 'sat' && d.id !== 'sun', from: '09:00', to: '17:00' }])) as BusinessHours['days'];

type Form = {
  name: string; status: string; description: string; address: string; coverage: string; notes: string;
  hoursMode: HoursMode; days: BusinessHours['days']; category: string; websites: [string, string]; email: string; phone: string;
};

function toForm(name: string, b: BusinessProfile | null): Form {
  return {
    name,
    status: b?.status_text ?? '', description: b?.description ?? '', address: b?.address ?? '', coverage: b?.coverage_area ?? '',
    notes: b?.location_notes ?? '', hoursMode: b?.hours?.mode ?? 'none', days: b?.hours?.days ?? defaultDays(),
    category: b?.category ?? '', websites: [b?.websites[0] ?? '', b?.websites[1] ?? ''], email: b?.email ?? '', phone: b?.phone ?? '',
  };
}

const clean = (v: string) => v.trim() || null;
const withScheme = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/** An icon on the left, a small label and the field, with a divider: one row of WhatsApp's edit-profile list. */
function Row({ icon: Icon, label, hint, children }: { icon: typeof Store; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-3 border-b border-wa-lightBorder dark:border-wa-darkBorder">
      <Icon className={`w-5 h-5 mt-5 flex-shrink-0 ${mutedText}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs ${mutedText}`}>{label}</p>
        {children}
        {hint && <p className={`text-[11px] mt-1 ${mutedText}`}>{hint}</p>}
      </div>
    </div>
  );
}
const field = `w-full bg-transparent text-[15px] py-1 border-b border-transparent focus:border-wa-green focus:outline-none transition-colors disabled:opacity-50 ${bodyText}`;

/** A drawn street-map tile with a pin (Pulse does not geocode); "Open in Maps" searches the address. */
function MapPreview({ address }: { address: string }) {
  const q = address.trim();
  return (
    <div className="relative mt-2 h-28 rounded-xl overflow-hidden border border-wa-lightBorder dark:border-wa-darkBorder bg-[#e8efe4] dark:bg-[#1c2a24]">
      <svg viewBox="0 0 320 112" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <g className="stroke-white dark:stroke-[#2c3d35]" fill="none" strokeLinecap="round">
          <path d="M-10 70 C 60 60, 120 90, 200 64 S 300 40, 340 52" strokeWidth="9" />
          <path d="M90 -10 L 120 130" strokeWidth="6" />
          <path d="M230 -10 C 220 40, 250 80, 236 130" strokeWidth="6" />
          <path d="M-10 24 L 340 30" strokeWidth="4" />
          <path d="M-10 100 L 340 92" strokeWidth="3" />
        </g>
        <rect x="140" y="8" width="56" height="34" rx="4" className="fill-[#cfe3c6] dark:fill-[#20352a]" />
        <rect x="258" y="70" width="48" height="26" rx="4" className="fill-[#cfe3c6] dark:fill-[#20352a]" />
      </svg>
      <MapPin className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full w-8 h-8 text-red-500 fill-red-500/30 drop-shadow" />
      {q && (
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer"
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/95 dark:bg-zinc-900/90 px-2.5 py-1 text-[11px] font-semibold text-wa-green shadow-sm">
          <ExternalLink className="w-3 h-3" />Open in Maps
        </a>
      )}
    </div>
  );
}

/** Business tools > Business profile: WhatsApp Business's edit screen in a modal (X closes, Save on the right). */
export default function BusinessProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { show } = useToast();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saved, setSaved] = useState<BusinessProfile | null>(null);
  const [form, setForm] = useState<Form>(() => toForm(profile?.display_name ?? '', null));
  const [initial, setInitial] = useState<Form>(form);
  const [avatar, setAvatar] = useState<{ file: File; url: string } | null>(null);
  const [cover, setCover] = useState<{ file: File; url: string } | null>(null);
  const [editingStatus, setEditingStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const userId = user?.id;
  const displayName = profile?.display_name ?? '';

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    api.getBusinessProfile(userId)
      .then((b) => {
        if (!alive) return;
        const f = toForm(displayName, b);
        setSaved(b);
        setForm(f);
        setInitial(f);
      })
      .catch((e) => {
        if (!alive) return;
        if (isMissingSchema(e)) setMissing(true);
        else setError(friendlyError(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, displayName]);

  // free picked-image previews when they are replaced or the modal closes
  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar.url); }, [avatar]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  const dirty = useMemo(() => !!avatar || !!cover || JSON.stringify(form) !== JSON.stringify(initial), [avatar, cover, form, initial]);
  if (!user || !profile) return null;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setDay = (day: WeekDay, patch: Partial<BusinessHours['days'][WeekDay]>) =>
    setForm((f) => ({ ...f, days: { ...f.days, [day]: { ...f.days[day], ...patch } } }));
  const pick = (max: number, onOk: (v: { file: File; url: string }) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Please choose a JPG, PNG or WebP image.');
    if (f.size > max) return setError(`Image is too large (max ${max / 1024 / 1024} MB).`);
    setError(null);
    onOk({ file: f, url: URL.createObjectURL(f) });
  };

  const save = async () => {
    const name = form.name.trim();
    if (name.length < 3 || name.length > 30) return setError('Business name must be 3-30 characters.');
    if (name.includes('@')) return setError('Your business name is public, so it can not be an email address.');
    const email = form.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError('That email address does not look right.');
    const phone = form.phone.trim();
    if (phone && !/^\+?[\d\s()-]{6,32}$/.test(phone)) return setError('Use digits only for the phone number, with an optional + in front.');
    setBusy(true);
    setError(null);
    try {
      if (name !== profile.display_name || avatar) {
        if (name.toLowerCase() !== profile.display_name.toLowerCase() && (await api.isDisplayNameTaken(name, user.id))) {
          setBusy(false);
          return setError('That name is already taken.');
        }
        const patch: { display_name: string; avatar_url?: string } = { display_name: name };
        if (avatar) patch.avatar_url = await api.uploadAvatar(user.id, avatar.file);
        await api.updateProfile(user.id, patch);
        await refreshProfile();
      }
      if (!missing) {
        const ext = cover?.file.type === 'image/png' ? 'png' : cover?.file.type === 'image/webp' ? 'webp' : 'jpg';
        const patch: BusinessProfilePatch = {
          cover_url: cover ? await api.uploadPostMedia(user.id, cover.file, ext) : saved?.cover_url ?? null,
          status_text: clean(form.status), description: clean(form.description), address: clean(form.address),
          coverage_area: clean(form.coverage), location_notes: clean(form.notes),
          hours: form.hoursMode === 'none' ? null : { mode: form.hoursMode, days: form.days },
          category: clean(form.category), websites: form.websites.map((w) => w.trim()).filter(Boolean).map(withScheme),
          email: email || null, phone: phone || null,
        };
        await api.saveBusinessProfile(user.id, patch);
      }
      show('Business profile saved');
      onClose();
    } catch (err) {
      setError(isMissingSchema(err) ? MIGRATION_NOTE : friendlyError(err));
      setBusy(false);
    }
  };

  const off = missing || loading;
  const coverUrl = cover?.url ?? saved?.cover_url ?? null;
  const saveButton = (
    <button type="button" onClick={() => void save()} disabled={busy || !dirty}
      className="rounded-full bg-wa-green px-4 py-1.5 text-sm font-semibold text-white hover:bg-wa-greenDark disabled:opacity-40 transition-colors flex items-center gap-1.5">
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}Save
    </button>
  );

  return (
    <Modal title="Business profile" onClose={onClose} action={saveButton}>
      <div className="scroll-smooth">
        {/* cover photo, profile photo and the "What's happening?" note */}
        <div className="-mx-5 -mt-4 relative">
          <button type="button" onClick={() => coverRef.current?.click()} disabled={off} aria-label={coverUrl ? 'Change cover photo' : 'Add cover photo'}
            className="group block w-full h-32 bg-wa-lightSecondary dark:bg-wa-darkSecondary overflow-hidden disabled:cursor-default">
            {coverUrl && <img src={coverUrl} alt="" className="w-full h-full object-cover" />}
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white opacity-90 group-hover:opacity-100">
              <Camera className="w-4 h-4" />{coverUrl ? 'Edit cover' : 'Add cover photo'}
            </span>
          </button>
          <input ref={coverRef} type="file" accept={TYPES.join(',')} onChange={pick(COVER_MAX, setCover)} className="hidden" aria-label="Cover photo file" />
          <div className="absolute left-1/2 -bottom-12 -translate-x-1/2">
            <button type="button" onClick={() => avatarRef.current?.click()} aria-label="Change profile photo"
              className="group relative rounded-full ring-4 ring-wa-lightPanel dark:ring-wa-darkPanel focus:outline-none focus-visible:ring-wa-green">
              <Avatar name={form.name || profile.display_name} url={avatar?.url ?? profile.avatar_url} size={96} />
              <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-6 h-6" />
              </span>
            </button>
            <input ref={avatarRef} type="file" accept={TYPES.join(',')} onChange={pick(AVATAR_MAX, setAvatar)} className="hidden" aria-label="Profile photo file" />
            {/* the note sits in a speech bubble off the photo's top-right, like WhatsApp */}
            <div className="absolute -top-6 left-[72px] max-w-[11rem]">
              {editingStatus ? (
                <input value={form.status} onChange={(e) => set('status', e.target.value.slice(0, STATUS_MAX))} onBlur={() => setEditingStatus(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingStatus(false); }} autoFocus placeholder="What's happening?"
                  aria-label="What's happening?" className={`w-44 rounded-2xl rounded-bl-sm bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-wa-green ${bodyText}`} />
              ) : (
                <button type="button" onClick={() => setEditingStatus(true)} disabled={off}
                  className={`block max-w-full truncate rounded-2xl rounded-bl-sm bg-wa-lightPanel dark:bg-wa-darkSecondary shadow-md px-3 py-1.5 text-xs text-left ${form.status ? bodyText : mutedText}`}>
                  {form.status || "What's happening?"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-16">
          {missing && <div className="mb-3"><ErrorNote message={MIGRATION_NOTE} /></div>}
          {error && <div className="mb-3"><ErrorNote message={error} /></div>}
          {loading && <Spinner label="Loading business profile" />}

          <Row icon={Store} label="Business name" hint="Public. Customers see this name and your photo.">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={30} aria-label="Business name" className={field} />
          </Row>
          <Row icon={AlignLeft} label="Description" hint={`${form.description.length}/512`}>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value.slice(0, 512))} rows={2} disabled={off}
              placeholder="Describe your business" aria-label="Description" className={`${field} resize-none`} />
          </Row>
          <Row icon={MapPin} label="Address">
            <input value={form.address} onChange={(e) => set('address', e.target.value.slice(0, 256))} disabled={off} placeholder="Street, building, city" aria-label="Address" className={field} />
          </Row>
          <Row icon={Radius} label="Coverage area" hint="Where you deliver or serve customers.">
            <input value={form.coverage} onChange={(e) => set('coverage', e.target.value.slice(0, 128))} disabled={off} placeholder="e.g. All of Kampala" aria-label="Coverage area" className={field} />
          </Row>
          <Row icon={StickyNote} label="Location notes">
            <input value={form.notes} onChange={(e) => set('notes', e.target.value.slice(0, 256))} disabled={off} placeholder="e.g. Second floor, blue door" aria-label="Location notes" className={field} />
            <MapPreview address={form.address} />
          </Row>

          <Row icon={Clock} label="Business hours">
            <div className="flex flex-wrap gap-1.5 mt-1.5" role="radiogroup" aria-label="Business hours">
              {HOURS_MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={form.hoursMode === m.id} onClick={() => set('hoursMode', m.id)} disabled={off}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors disabled:opacity-50 ${form.hoursMode === m.id ? 'border-wa-green bg-wa-green/10 text-wa-green' : `border-wa-lightBorder dark:border-wa-darkBorder ${bodyText}`}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {form.hoursMode === 'custom' && (
              <ul className="mt-2 divide-y divide-wa-lightBorder dark:divide-wa-darkBorder">
                {DAYS.map(({ id, label }) => {
                  const d = form.days[id];
                  return (
                    <li key={id} className="flex items-center gap-2 py-1.5 text-sm">
                      <label className={`flex items-center gap-2 w-32 ${bodyText}`}>
                        <input type="checkbox" checked={d.open} onChange={(e) => setDay(id, { open: e.target.checked })} disabled={off} className="accent-wa-green" />
                        {label}
                      </label>
                      {d.open ? (
                        <span className="flex items-center gap-1.5 ml-auto">
                          <input type="time" value={d.from} onChange={(e) => setDay(id, { from: e.target.value })} disabled={off} aria-label={`${label} opens`}
                            className={`bg-wa-lightSecondary dark:bg-wa-darkSecondary rounded-md px-1.5 py-0.5 text-xs ${bodyText}`} />
                          <span className={mutedText}>–</span>
                          <input type="time" value={d.to} onChange={(e) => setDay(id, { to: e.target.value })} disabled={off} aria-label={`${label} closes`}
                            className={`bg-wa-lightSecondary dark:bg-wa-darkSecondary rounded-md px-1.5 py-0.5 text-xs ${bodyText}`} />
                        </span>
                      ) : (
                        <span className={`ml-auto text-xs ${mutedText}`}>Closed</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Row>

          <Row icon={Briefcase} label="Category">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} disabled={off} aria-label="Category" className={`${field} cursor-pointer`}>
              <option value="">Choose a category</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>

          <button type="button" onClick={() => show('Catalog is coming soon to Pulse')}
            className="flex w-full items-center gap-4 py-3 text-left border-b border-wa-lightBorder dark:border-wa-darkBorder hover:bg-wa-lightSecondary/60 dark:hover:bg-wa-darkSecondary/40 transition-colors">
            <ShoppingBag className={`w-5 h-5 flex-shrink-0 ${mutedText}`} />
            <span className="flex-1 min-w-0">
              <span className={`block text-[15px] ${bodyText}`}>Products & services</span>
              <span className={`block text-xs ${mutedText}`}>Show your catalog on your profile</span>
            </span>
            <ChevronRight className={`w-4 h-4 ${mutedText}`} />
          </button>

          <Row icon={Link2} label="Links" hint="Up to two websites or social pages.">
            {form.websites.map((w, i) => (
              <input key={i} value={w} onChange={(e) => set('websites', (i === 0 ? [e.target.value, form.websites[1]] : [form.websites[0], e.target.value]) as [string, string])}
                disabled={off} inputMode="url" placeholder={i === 0 ? 'Website' : 'Another website'} aria-label={`Website ${i + 1}`} className={field} />
            ))}
          </Row>

          <p className={`text-sm font-medium pt-4 pb-1 ${mutedText}`}>Contact information</p>
          <Row icon={Mail} label="Email">
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={off} placeholder="Business email" aria-label="Email" className={field} />
          </Row>
          <Row icon={Phone} label="Phone number">
            <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} disabled={off} placeholder="+256 …" aria-label="Phone number" className={field} />
          </Row>
          <p className={`text-[11px] pt-3 ${mutedText}`}>Everything on your business profile is public, so customers can find and contact you.</p>
        </div>
      </div>
    </Modal>
  );
}
