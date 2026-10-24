import { MessageCircle, Phone, CircleDashed, MessageSquareDot, Users, Store, Megaphone, Images, User, type LucideIcon } from 'lucide-react';

/** Every screen of the app shell. `updates` (Status + Channels together) is the phone layout's version of the two. */
export type SectionId = 'chats' | 'calls' | 'status' | 'channels' | 'communities' | 'catalog' | 'broadcasts' | 'media' | 'profile' | 'updates';

export type SectionDef = { id: SectionId; label: string; icon: LucideIcon };

/** Desktop rail, WhatsApp Business layout: messaging on top, business tools under the divider, personal at the bottom. */
export const RAIL_TOP: SectionDef[] = [
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'status', label: 'Status', icon: CircleDashed },
  { id: 'channels', label: 'Channels', icon: MessageSquareDot },
  { id: 'communities', label: 'Communities', icon: Users },
];
export const RAIL_BUSINESS: SectionDef[] = [
  { id: 'catalog', label: 'Venue catalog', icon: Store },
  { id: 'broadcasts', label: 'Broadcast blasts', icon: Megaphone },
];
export const RAIL_BOTTOM: SectionDef[] = [{ id: 'media', label: 'Media gallery', icon: Images }];

/** Phone bottom bar (five slots). Calls, Broadcasts and Media are in the You screen's menu. */
export const MOBILE_TABS: SectionDef[] = [
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'updates', label: 'Updates', icon: CircleDashed },
  { id: 'communities', label: 'Communities', icon: Users },
  { id: 'catalog', label: 'Catalog', icon: Store },
  { id: 'profile', label: 'You', icon: User },
];

/** Which phone tab lights up for a desktop-only section (e.g. Status -> Updates). */
export function mobileTabFor(id: SectionId): SectionId {
  if (id === 'status' || id === 'channels') return 'updates';
  if (id === 'calls' || id === 'broadcasts' || id === 'media') return 'profile';
  return id;
}

/** On a phone, Status and Channels live together under Updates; on desktop Updates splits back into Status. */
export function normalizeSection(id: SectionId, mobile: boolean): SectionId {
  if (mobile && (id === 'status' || id === 'channels')) return 'updates';
  if (!mobile && id === 'updates') return 'status';
  return id;
}
