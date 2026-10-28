import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Send } from 'lucide-react';
import Modal from '@/components/Modal';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { useEmojiInsert } from '@/components/emoji/useEmojiInsert';
import { ErrorNote, inputClass, primaryBtn, ghostBtn, mutedText } from '@/components/ui';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { prepareStatusMedia, type PreparedMedia } from '@/lib/statusMedia';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const MAX_CAPTION = 300;

/** Create a status: pick a photo/video, add a caption, post. It disappears after 24 hours. */
export default function StatusComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const { user, canWrite } = useAuth();
  const { show } = useToast();
  const [media, setMedia] = useState<PreparedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const insert = useEmojiInsert(captionRef, caption, setCaption, MAX_CAPTION);

  // free the preview when it is replaced or the dialog closes
  useEffect(() => () => { if (media) URL.revokeObjectURL(media.previewUrl); }, [media]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setMedia(await prepareStatusMedia(file));
    } catch (e) {
      setMedia(null);
      setError((e as Error).message);
    }
  };

  const post = async () => {
    if (!media || !user) return;
    setBusy(true);
    setError(null);
    try {
      // the file goes into the signed-in user's own folder; the database then stamps who posted it
      const url = await api.uploadPostMedia(user.id, media.blob, media.ext);
      await api.createStatus({ media_url: url, media_type: media.type, caption });
      show('Status posted. It stays up for 24 hours.');
      onPosted();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="New status" icon={Camera} onClose={onClose}>
      {!canWrite ? (
        <p className={`text-sm ${mutedText}`}>Your account is restricted, so you can not post a status right now.</p>
      ) : (
        <div className="space-y-4">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" className="sr-only" aria-label="Choose a photo or video" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          {media ? (
            <div className="relative rounded-2xl overflow-hidden bg-black mx-auto" style={{ aspectRatio: '9 / 16', maxHeight: '48vh' }}>
              {media.type === 'video' ? (
                <video src={media.previewUrl} controls muted playsInline className="w-full h-full object-contain" />
              ) : (
                <img src={media.previewUrl} alt="Status preview" className="w-full h-full object-contain" />
              )}
              <button type="button" onClick={() => fileRef.current?.click()} className="absolute bottom-2 right-2 rounded-full px-3 py-1.5 text-xs font-semibold bg-black/60 text-white">Change</button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-wa-green/50 py-10 flex flex-col items-center gap-2 text-wa-green hover:bg-wa-green/5 transition-colors">
              <ImagePlus className="w-8 h-8" />
              <span className="text-sm font-semibold">Choose a photo or video</span>
              <span className={`text-xs ${mutedText}`}>Photos up to 25 MB, videos up to 30 s</span>
            </button>
          )}

          <div className="flex items-center gap-1">
            <input ref={captionRef} value={caption} onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))} placeholder="Add a caption…" aria-label="Caption" className={inputClass} />
            <EmojiButton label="Add emoji to caption" onPick={insert} />
          </div>

          {error && <ErrorNote message={error} />}
          <div className="flex gap-2">
            <button onClick={post} disabled={!media || busy} className={`${primaryBtn} flex-1`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Post status
            </button>
            <button onClick={onClose} disabled={busy} className={ghostBtn}>Cancel</button>
          </div>
          <p className={`text-[11px] ${mutedText}`}>Your status is visible to everyone on Pulse for 24 hours, then it is removed.</p>
        </div>
      )}
    </Modal>
  );
}
