import { useRef, useState } from 'react';
import { Camera, Loader2, Store, PlusCircle } from 'lucide-react';
import Modal from '@/components/Modal';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Venue } from '@/lib/types';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DESC = 500;

/** Any signed-in user registers a club; they become its manager straight away (register_venue, migration 12). */
export default function RegisterVenueModal({ onClose, onRegistered }: { onClose: () => void; onRegistered: (venue: Venue) => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const coverRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<{ file: File; url: string } | null>(null);
  const [logo, setLogo] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const picker = (set: (v: { file: File; url: string }) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Please choose a JPG, PNG or WebP image.');
    if (f.size > MAX_BYTES) return setError('Image is too large (max 5 MB).');
    setError(null);
    set({ file: f, url: URL.createObjectURL(f) });
  };
  const upload = (f: File) => api.uploadPostMedia(user.id, f, f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const l = location.trim();
    if (n.length < 2 || n.length > 60) return setError('Club name must be 2-60 characters.');
    if (l.length < 2 || l.length > 60) return setError('Add the city or area (2-60 characters).');
    setBusy(true);
    setError(null);
    try {
      const [image_url, logo_url] = await Promise.all([cover ? upload(cover.file) : null, logo ? upload(logo.file) : null]);
      const venue = await api.registerVenue({ name: n, location: l, description, image_url, logo_url });
      show(`${venue.name} is registered. You manage it now.`);
      onRegistered(venue);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === '23505'
        ? `${n} in ${l} is already on Pulse. Use Request verification to claim it instead.`
        : friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Register a club" icon={PlusCircle} onClose={onClose}>
      <p className={`text-xs leading-relaxed mb-4 ${mutedText}`}>
        Add your venue to Pulse. You become its manager right away and can set its live status, edit its profile and post
        updates. The Official badge comes after the Pulse team verifies it.
      </p>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <div className="relative">
          <button type="button" onClick={() => coverRef.current?.click()}
            className="w-full h-32 rounded-xl overflow-hidden bg-wa-light dark:bg-wa-dark border border-dashed border-wa-lightBorder dark:border-wa-darkBorder flex items-center justify-center">
            {cover ? <img src={cover.url} alt="" className="w-full h-full object-cover" /> : (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-wa-green"><Camera className="w-4 h-4" />Add cover photo</span>
            )}
          </button>
          <input ref={coverRef} type="file" accept={TYPES.join(',')} onChange={picker(setCover)} aria-label="Cover photo" className="hidden" />
          <button type="button" onClick={() => logoRef.current?.click()} aria-label={logo ? 'Change logo' : 'Add logo'}
            className="absolute -bottom-6 left-3 w-16 h-16 rounded-full overflow-hidden bg-wa-lightPanel dark:bg-wa-darkPanel border-2 border-wa-lightBorder dark:border-wa-darkBorder flex items-center justify-center shadow-md">
            {logo ? <img src={logo.url} alt="" className="w-full h-full object-cover" /> : <Store className={`w-6 h-6 ${mutedText}`} />}
          </button>
          <input ref={logoRef} type="file" accept={TYPES.join(',')} onChange={picker(setLogo)} aria-label="Logo" className="hidden" />
        </div>
        <p className={`text-[11px] pl-[5.25rem] ${mutedText}`}>Tap to add a logo and cover. JPG, PNG or WebP, up to 5 MB.</p>

        <Field label="Club name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Sky Lounge" className={inputClass} />
        </Field>
        <Field label="City / area" hint="Shown under the name, e.g. Kololo, Kampala.">
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} className={inputClass} />
        </Field>
        <Field label="About" hint={`${description.length}/${MAX_DESC}`}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))} rows={3}
            placeholder="Music, dress code, opening hours..." className={`${inputClass} resize-none`} />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Register club
        </button>
      </form>
    </Modal>
  );
}
