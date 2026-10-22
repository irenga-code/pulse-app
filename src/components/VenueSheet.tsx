import { MapPin, Phone, MessageCircle, Bookmark, Plus, Check, Store } from 'lucide-react';
import Modal from '@/components/Modal';
import VenueLogo from '@/components/VenueLogo';
import VenueStatusBadge from '@/components/VenueStatusBadge';
import VenueVibes from '@/components/reactions/VenueVibes';
import { ghostBtn, primaryBtn, mutedText, bodyText } from '@/components/ui';
import { useVenueLibrary } from '@/context/VenueLibraryContext';
import type { Venue } from '@/lib/types';

/** wa.me wants the number with country code and digits only. */
const waLink = (n: string) => `https://wa.me/${n.replace(/\D/g, '')}`;
const telLink = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;

/** A venue's public profile: cover, logo, status, About, address and contact links. */
export default function VenueSheet({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  const { isSaved, toggleSaved, isFollowing, toggleFollow } = useVenueLibrary();
  const saved = isSaved(venue.id);
  const following = isFollowing(venue.id);

  return (
    <Modal title={venue.name} icon={Store} onClose={onClose}>
      <div className="-mx-5 -mt-4 mb-3 relative h-44 bg-wa-darkSecondary">
        {venue.image_url ? (
          <img src={venue.image_url} alt={venue.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MapPin className="w-10 h-10 text-wa-quiet" />
          </div>
        )}
        <VenueStatusBadge venue={venue} className="absolute top-3 left-3" />
      </div>

      <div className="flex items-center gap-3">
        <VenueLogo venue={venue} size={64} className="-mt-10 relative shadow-md" />
        <div className="min-w-0 flex-1">
          <h3 className={`font-bold text-lg truncate ${bodyText}`}>{venue.name}</h3>
          <p className={`flex items-center gap-1 text-xs ${mutedText}`}>
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{venue.location}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        <button onClick={() => toggleSaved(venue.id)} aria-pressed={saved} className={ghostBtn}>
          <Bookmark className={`w-4 h-4 ${saved ? 'fill-wa-green text-wa-green' : ''}`} />
          {saved ? 'Saved' : 'Save'}
        </button>
        <button onClick={() => toggleFollow(venue.id)} aria-pressed={following} className={following ? ghostBtn : primaryBtn}>
          {following ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      {venue.description && (
        <section className="mt-5">
          <h4 className={`text-xs font-semibold uppercase tracking-wide mb-1 ${mutedText}`}>About</h4>
          <p className={`text-sm leading-relaxed whitespace-pre-line ${bodyText}`}>{venue.description}</p>
        </section>
      )}

      {venue.address && (
        <p className={`flex items-start gap-2 text-sm mt-4 ${bodyText}`}>
          <MapPin className={`w-4 h-4 mt-0.5 flex-shrink-0 ${mutedText}`} />
          {venue.address}
        </p>
      )}

      {(venue.phone || venue.whatsapp) && (
        <div className="flex flex-wrap gap-2 mt-4">
          {venue.phone && (
            <a href={telLink(venue.phone)} className={ghostBtn}>
              <Phone className="w-4 h-4" />
              Call
            </a>
          )}
          {venue.whatsapp && (
            <a href={waLink(venue.whatsapp)} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
        </div>
      )}

      <div className="mt-4">
        <VenueVibes venueId={venue.id} />
      </div>
    </Modal>
  );
}
