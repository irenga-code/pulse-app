import ReactionBar from '@/components/reactions/ReactionBar';
import ReactionBurst from '@/components/reactions/ReactionBurst';
import { useVenueVibes } from '@/context/VenueVibesContext';

/** "Tonight's vibe": live emoji reactions for a venue (last 12 hours). */
export default function VenueVibes({ venueId }: { venueId: string }) {
  const v = useVenueVibes();
  return (
    <div className="relative mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder">
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
        Tonight's vibe
      </p>
      <ReactionBar compact counts={v.countsFor(venueId)} mine={v.mineFor(venueId)} onReact={(k) => v.react(venueId, k)} />
      <ReactionBurst items={v.burstsFor(venueId)} onDone={(id) => v.dismissBurst(venueId, id)} />
    </div>
  );
}
