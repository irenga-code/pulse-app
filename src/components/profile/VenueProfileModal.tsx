import { Store } from 'lucide-react';
import Modal from '@/components/Modal';
import VenueProfileForm from '@/components/profile/VenueProfileForm';
import { mutedText } from '@/components/ui';
import type { Venue, VenueProfilePatch } from '@/lib/types';

/** Edit any venue's public profile in a sheet. Admins may edit every venue (manages_venue() includes is_admin()). */
export default function VenueProfileModal({ venue, onClose, onSaved }: { venue: Venue; onClose: () => void; onSaved?: (patch: VenueProfilePatch) => void }) {
  return (
    <Modal title={`Edit ${venue.name}`} icon={Store} onClose={onClose}>
      <p className={`text-xs mb-4 ${mutedText}`}>{venue.location}. Changes show in the app right away.</p>
      <VenueProfileForm
        key={venue.id}
        venue={venue}
        onSaved={(patch) => {
          onSaved?.(patch);
          onClose();
        }}
      />
    </Modal>
  );
}
