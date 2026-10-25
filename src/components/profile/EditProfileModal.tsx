import { useRef, useState } from 'react';
import { UserCog, BadgeCheck } from 'lucide-react';
import Modal from '@/components/Modal';
import VerificationModal from '@/components/profile/VerificationModal';
import ProfileForm, { type ProfileDraft } from '@/components/profile/ProfileForm';
import { ghostBtn, mutedText } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const draft = useRef<ProfileDraft | null>(null);

  if (!user || !profile) return null;
  // swap rather than stack, so Esc only closes the verification sheet and returns here with edits intact
  if (verifying) return <VerificationModal onClose={() => setVerifying(false)} />;

  return (
    <Modal title="Edit profile" icon={UserCog} onClose={onClose}>
      <ProfileForm onSaved={onClose} draft={draft} />
      <div className="mt-5 pt-4 border-t border-wa-lightBorder dark:border-wa-darkBorder">
        <p className={`text-xs mb-2 ${mutedText}`}>Performer, staff or venue account? Request verification for a new role or venue.</p>
        <button type="button" onClick={() => setVerifying(true)} className={`${ghostBtn} w-full`}>
          <BadgeCheck className="w-4 h-4" />
          Request verification
        </button>
      </div>
    </Modal>
  );
}
