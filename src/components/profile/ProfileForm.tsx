import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { Field, ErrorNote, inputClass, primaryBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ABOUT_MAX = 280;

/** Unsaved edits, kept by the parent so they survive the form being swapped out (e.g. for the verification sheet). */
export type ProfileDraft = { name: string; bio: string; file: File | null; preview: string | null };

/** Photo (with preview before saving), display name and about. Used by Edit profile and Settings > Profile. */
export default function ProfileForm({ onSaved, large = false, draft }: {
  onSaved?: () => void; large?: boolean; draft?: { current: ProfileDraft | null };
}) {
  const { user, profile, refreshProfile } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const kept = draft?.current;
  const [name, setName] = useState(kept?.name ?? profile?.display_name ?? '');
  const [bio, setBio] = useState(kept?.bio ?? profile?.bio ?? '');
  const [file, setFile] = useState<File | null>(kept?.file ?? null);
  const [preview, setPreview] = useState<string | null>(kept?.preview ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (draft) draft.current = { name, bio, file, preview }; }, [draft, name, bio, file, preview]);
  // a kept draft still needs its preview image; otherwise free it when it is replaced or the form goes away
  useEffect(() => () => { if (preview && !draft) URL.revokeObjectURL(preview); }, [preview, draft]);

  if (!user || !profile) return null;
  const dirty = name.trim() !== profile.display_name || (bio.trim() || null) !== (profile.bio ?? null) || !!file;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
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
      setFile(null);
      if (draft) draft.current = null;
      show('Profile updated');
      onSaved?.();
    } catch (err) {
      setError(friendlyError(err));
    }
    setBusy(false);
  };

  const size = large ? 128 : 72;
  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <div className={large ? 'flex flex-col items-center gap-3 py-2' : 'flex items-center gap-4'}>
        <button type="button" onClick={() => fileRef.current?.click()} aria-label={profile.avatar_url || preview ? 'Change profile photo' : 'Add profile photo'}
          className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-wa-green">
          <Avatar name={name || profile.display_name} url={preview ?? profile.avatar_url} size={size} />
          <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[11px] font-semibold uppercase tracking-wide">
            <Camera className="w-5 h-5 mb-0.5" />{large ? 'Change photo' : ''}
          </span>
        </button>
        <div className={large ? 'text-center' : ''}>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-semibold text-wa-green">
            <Camera className="w-4 h-4" />
            {profile.avatar_url || preview ? 'Change photo' : 'Add photo'}
          </button>
          <p className={`text-[11px] mt-1 ${mutedText}`}>{preview ? 'Preview. Save to use it.' : 'JPG, PNG or WebP, up to 2 MB.'}</p>
          <input ref={fileRef} type="file" accept={TYPES.join(',')} onChange={pick} className="hidden" aria-label="Profile photo file" />
        </div>
      </div>
      <Field label="Display name" hint="Public. This and your photo are all other people see.">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} className={inputClass} />
      </Field>
      <Field label="About" hint={`${bio.length}/${ABOUT_MAX}`}>
        <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, ABOUT_MAX))} rows={3} placeholder="Hey there! I am using Pulse." className={`${inputClass} resize-none`} />
      </Field>
      {error && <ErrorNote message={error} />}
      <button type="submit" disabled={busy || !dirty} className={`${primaryBtn} w-full`}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        Save changes
      </button>
    </form>
  );
}
