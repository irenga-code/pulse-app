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
  const [description, setDescription] = useState(venue.description ?? '');
  const [address, setAddress] = useState(venue.address ?? '');
  const [phone, setPhone] = useState(venue.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(venue.whatsapp ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Please choose a JPG, PNG or WebP image.');
    if (f.size > MAX_BYTES) return setError('Image is too large (max 5 MB).');
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

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
      if (file) {
        const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
        patch.image_url = await api.uploadPostMedia(user.id, file, ext);
      }
      await api.updateVenueProfile(venue.id, patch);
      onSaved(patch);
      setFile(null);
      show(`${venue.name} profile updated`);
    } catch (err) {
      setError(friendlyError(err));
    }
    setBusy(false);
  };

  const image = preview ?? venue.image_url;

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
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
          <input ref={fileRef} type="file" accept={TYPES.join(',')} onChange={pick} className="hidden" />
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
