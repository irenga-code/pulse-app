import { Phone, Video } from 'lucide-react';
import SectionHeader from '@/components/nav/SectionHeader';
import { mutedText, bodyText } from '@/components/ui';

/** Placeholder: voice / video calling needs a WebRTC + signalling backend that Pulse does not have yet. */
export default function CallsTab() {
  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Calls" />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
        <div className="flex gap-3 mb-4">
          <span className="w-14 h-14 rounded-full bg-wa-green/15 flex items-center justify-center"><Phone className="w-7 h-7 text-wa-green" /></span>
          <span className="w-14 h-14 rounded-full bg-wa-green/15 flex items-center justify-center"><Video className="w-7 h-7 text-wa-green" /></span>
        </div>
        <p className={`text-base font-semibold ${bodyText}`}>Calls are coming to Pulse</p>
        <p className={`text-sm mt-1 max-w-sm ${mutedText}`}>
          Voice and video calls with friends are on the way. Until then, send a message or a snap from Chats.
        </p>
      </div>
    </div>
  );
}
