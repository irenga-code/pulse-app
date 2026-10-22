export type VenueStatus = 'live' | 'sold_out' | 'not_active';

export type Venue = {
  id: string;
  name: string;
  slug?: string | null;
  location: string;
  status: VenueStatus;
  status_expires_at?: string | null;
  /** From venues_public: live status or an event running now (see isVenueLive). */
  is_live?: boolean;
  /** Cover photo. */
  image_url: string | null;
  /** Square logo / profile picture (migration 11; undefined before it is applied). */
  logo_url?: string | null;
  /** Who registered it with Register a club (migration 12; on venues_public from migration 13). */
  created_by?: string | null;
  is_verified?: boolean;
  /** Profile fields linked hosts/managers can edit (My venues). */
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  created_at: string;
};

/** A venue the signed-in user is linked to in `venue_managers` (migration 9 adds 'host'). */
export type VenueRole = 'owner' | 'manager' | 'host';
export type ManagedVenue = { venue_id: string; role: VenueRole };
export type VenueProfilePatch = Partial<Pick<Venue, 'description' | 'address' | 'phone' | 'whatsapp' | 'image_url' | 'logo_url'>>;

export type Post = {
  id: string;
  user_id: string | null;
  user_name: string;
  venue_id: string | null;
  venue_name: string | null;
  content: string;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  media_width: number | null;
  media_height: number | null;
  media_duration_ms: number | null;
  media_meta: SnapMeta;
  /** 'snap' = camera post that expires 24 hours after posting. */
  kind: 'post' | 'snap';
  expires_at: string | null;
  is_official: boolean;
  /** Published as the venue: user_name is the venue's name (migration 9; optional for an older database). */
  as_venue?: boolean;
  status: 'visible' | 'removed';
  likes: number;
  comments: number;
  /** Added by migration 5; optional so an older database still works. */
  reposts?: number;
  views?: number;
  created_at: string;
};

export type SnapMeta = { filter?: string; effect?: string; geo?: string; stamp?: string; tools?: string[] };

export type NewPostInput = {
  content: string;
  venue_id?: string | null;
  /** Post as the venue (venue_id required; only for venues you are linked to). */
  as_venue?: boolean;
  kind?: 'post' | 'snap';
  media_url?: string;
  media_type?: 'image' | 'video';
  media_width?: number;
  media_height?: number;
  media_duration_ms?: number;
  media_meta?: SnapMeta;
};

export type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  user_name: string;
  body: string;
  created_at: string;
};

/** Reaction kinds come from the `reaction_types` table (the emoji palette), so this is open-ended. */
export type ReactionKind = string;
export type ReactionType = { kind: ReactionKind; emoji: string; label: string; sort: number };
/** Used until the palette loads (or if it can not be reached). Mirrors the seed in migration 4. */
export const DEFAULT_REACTIONS: ReactionType[] = [
  { kind: 'fire', emoji: '🔥', label: 'Fire', sort: 10 },
  { kind: 'heart', emoji: '❤️', label: 'Love', sort: 20 },
  { kind: 'party', emoji: '🎉', label: 'Party', sort: 30 },
  { kind: 'laugh', emoji: '😂', label: 'Funny', sort: 40 },
  { kind: 'wow', emoji: '😮', label: 'Wow', sort: 50 },
  { kind: 'clap', emoji: '👏', label: 'Applause', sort: 60 },
  { kind: 'dance', emoji: '💃', label: 'Dancing', sort: 70 },
  { kind: 'music', emoji: '🎶', label: 'Great music', sort: 80 },
  { kind: 'bottle', emoji: '🍾', label: 'Bottles', sort: 90 },
  { kind: 'cool', emoji: '😎', label: 'Cool', sort: 100 },
];
/** kind -> number of people who used it */
export type ReactionCounts = Record<ReactionKind, number>;

export type AccountType = 'user' | 'host' | 'venue';
export type AccountStatus = 'active' | 'suspended' | 'banned';

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  account_type: AccountType;
  is_verified: boolean;
  status: AccountStatus;
  created_at: string;
};

/** Public subset shown next to posts/comments. */
export type PublicProfile = Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'account_type' | 'is_verified' | 'status'>;
/** admin_find_users result: the email is only matched, never returned. */
export type StaffCandidate = PublicProfile & { matched_email: boolean };
export type VenueStaffRow = { venue_id: string; user_id: string; role: VenueRole; created_at: string };

export type Preferences = {
  theme: 'dark' | 'light' | 'system';
  live_venue_alerts: boolean;
  community_alerts: boolean;
  announcements: boolean;
};

export type NotificationType =
  | 'venue_live' | 'community' | 'system' | 'follow' | 'reaction' | 'comment' | 'official_post' | 'moderation' | 'event';

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  venue_id: string | null;
  post_id?: string | null;
  created_at: string;
};

export type ReportTarget = 'post' | 'comment' | 'user' | 'venue' | 'event' | 'review' | 'status';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'violence' | 'sexual' | 'scam' | 'misinformation' | 'other';
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'misinformation', label: 'False information' },
  { value: 'other', label: 'Something else' },
];

export type ReportRow = {
  id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'actioned' | 'dismissed';
  created_at: string;
  reporter_name: string | null;
  target_preview: string | null;
  target_user_id: string | null;
};

/** Performer / staff roles, in display order. The exact spelling is stored and shown ("Mc", "Dj"). */
export const VERIFICATION_ROLES = ['Manager', 'Host', 'Mc', 'Dj', 'Promoter', 'Musician', 'Dancer'] as const;
export type VerificationRole = (typeof VERIFICATION_ROLES)[number];

export type VerificationRequest = {
  id: string;
  user_id: string;
  kind: 'host' | 'venue';
  /** Set on 'host' (Performer / Staff) requests; null on venue requests and on requests made before roles existed. */
  role: VerificationRole | null;
  venue_id: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  created_at: string;
};

export type ModerationLogRow = {
  id: number;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  note: string | null;
  created_at: string;
};


// ---------------------------------------------------------------- engagement, profiles
export type ProfileStats = {
  user_id: string;
  follower_count: number;
  following_count: number;
  post_count: number;
  /** Vibe Rep: reactions/likes earned on this person's posts and snaps. */
  vibe_rep: number;
};

// ---------------------------------------------------------------- statuses (24 h stories)
export type Status = {
  id: string;
  user_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption: string | null;
  venue_id: string | null;
  created_at: string;
  expires_at: string;
};
export type NewStatusInput = { media_url: string; media_type: 'image' | 'video'; caption?: string | null; venue_id?: string | null };

// ---------------------------------------------------------------- direct messages
export type MessageRefType = 'post' | 'status';
export type MessageRef = { type: MessageRefType; id: string };
export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  kind: 'text' | 'system';
  ref_type: MessageRefType | null;
  ref_id: string | null;
  /** Sent while vanish mode was on: disappears after the other person reads it. */
  vanish: boolean;
  created_at: string;
  read_at: string | null;
  /** When a vanish message (or an unread-for-24h one) disappears. */
  expires_at: string | null;
};
export type ConversationSummary = {
  conversation_id: string;
  other_user_id: string;
  vanish_mode: boolean;
  last_message_at: string;
  last_body: string | null;
  last_sender_id: string | null;
  last_kind: 'text' | 'system' | null;
  last_vanish: boolean | null;
  unread_count: number;
};
