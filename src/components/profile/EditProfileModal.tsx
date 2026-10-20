import { useRef, useState } from 'react';
import { UserCog, Camera, Loader2 } from 'lucide-react';
import Modal from '@/components/Modal';
import Avatar from '@/components/Avatar';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !profile) return null;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Please choose a JPG, PNG or WebP image.');
    if (f.size > MAX_BYTES) return setError('Image is too large (max 2 MB).');
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 3 || n.length > 30) return setError('Display name must be 3-30 characters.');
    if (n.includes('@')) return setError('Your display name is public, so it can not be an email address.');
    setBusy(true);
    setError(null);
    try {
      if (n.toLowerCase() !== profile.display_name.toLowerCase() && (await api.isDisplayNameTaken(n, user.id))) {
        setError('That display name is already taken.');
        setBusy(false);
        return;
      }
      const patch: { display_name: string; bio: string | null; avatar_url?: string } = { display_name: n, bio: bio.trim() || null };
      if (file) patch.avatar_url = await api.uploadAvatar(user.id, file);
      await api.updateProfile(user.id, patch);
      await refreshProfile();
      show('Profile updated');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit profile" icon={UserCog} onClose={onClose}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="flex items-center gap-4">
          <Avatar name={name || profile.display_name} url={preview ?? profile.avatar_url} size={72} />
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-semibold text-wa-green">
              <Camera className="w-4 h-4" />
              {profile.avatar_url || preview ? 'Change photo' : 'Add photo'}
            </button>
            <p className={`text-[11px] mt-1 ${mutedText}`}>JPG, PNG or WebP, up to 2 MB.</p>
            <input ref={fileRef} type="file" accept={TYPES.join(',')} onChange={pick} className="hidden" />
          </div>
        </div>
        <Field label="Display name" hint="Public. This and your photo are all other people see.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} className={inputClass} />
        </Field>
        <Field label="Bio" hint={`${bio.length}/280`}>
          <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 280))} rows={3} placeholder="Tell people what you're into" className={`${inputClass} resize-none`} />
        </Field>
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save changes
        </button>
      </form>
    </Modal>
  );
}
