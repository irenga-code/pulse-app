import { useRef, useState } from 'react';
import { Camera, Loader2, Store } from 'lucide-react';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Venue, VenueProfilePatch } from '@/lib/types';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DESC = 500;

/** Edits a linked venue's public profile. Mount with key={venue.id} so switching venues resets the form. */
export default function VenueProfileForm({ venue, onSaved }: { venue: Venue; onSaved: (patch: VenueProfilePatch) => void }) {
  const { user } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(venue.description ?? '');
  const [address, setAddress] = useState(venue.address ?? '');
  const [phone, setPhone] = useState(venue.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(venue.whatsapp ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picker = (setF: (f: File) => void, setP: (url: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Please choose a JPG, PNG or WebP image.');
    if (f.size > MAX_BYTES) return setError('Image is too large (max 5 MB).');
    setError(null);
    setF(f);
    setP(URL.createObjectURL(f));
  };
  const upload = (f: File) =>
    api.uploadPostMedia(user!.id, f, f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const patch: VenueProfilePatch = {
        description: description.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
      };
      if (file) patch.image_url = await upload(file);
      // only sent when changed, so saving the other fields still works before migration 11 adds the column
      if (logoFile) patch.logo_url = await upload(logoFile);
      await api.updateVenueProfile(venue.id, patch);
      onSaved(patch);
      setFile(null);
      setLogoFile(null);
      show(`${venue.name} profile updated`);
    } catch (err) {
      setError(friendlyError(err));
    }
    setBusy(false);
  };

  const image = preview ?? venue.image_url;
  const logo = logoPreview ?? venue.logo_url;

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full overflow-hidden bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder flex items-center justify-center flex-shrink-0">
          {logo ? <img src={logo} alt="" className="w-full h-full object-cover" /> : <Store className={`w-6 h-6 ${mutedText}`} />}
        </div>
        <div>
          <button type="button" onClick={() => logoRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-semibold text-wa-green">
            <Camera className="w-4 h-4" />
            {logo ? 'Change logo' : 'Add logo'}
          </button>
          <p className={`text-[11px] mt-1 ${mutedText}`}>Square works best. JPG, PNG or WebP, up to 5 MB.</p>
          <input ref={logoRef} type="file" accept={TYPES.join(',')} onChange={picker(setLogoFile, setLogoPreview)} aria-label="Logo" className="hidden" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-20 h-14 rounded-xl overflow-hidden bg-wa-light dark:bg-wa-dark border border-wa-lightBorder dark:border-wa-darkBorder flex items-center justify-center flex-shrink-0">
          {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : <Store className={`w-6 h-6 ${mutedText}`} />}
        </div>
        <div>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-semibold text-wa-green">
            <Camera className="w-4 h-4" />
            {image ? 'Change cover photo' : 'Add cover photo'}
          </button>
          <p className={`text-[11px] mt-1 ${mutedText}`}>JPG, PNG or WebP, up to 5 MB.</p>
          <input ref={fileRef} type="file" accept={TYPES.join(',')} onChange={picker(setFile, setPreview)} aria-label="Cover photo" className="hidden" />
        </div>
      </div>
      <Field label="About" hint={`${description.length}/${MAX_DESC}`}>
        <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))} rows={3}
          placeholder="Music, dress code, opening hours..." className={`${inputClass} resize-none`} />
      </Field>
      <Field label="Address">
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className={inputClass} />
        </Field>
        <Field label="WhatsApp">
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={30} inputMode="tel" className={inputClass} />
        </Field>
      </div>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Save venue profile
      </button>
    </form>
  );
}
