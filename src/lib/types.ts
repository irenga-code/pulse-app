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
  /** A confirmed phone number is on file (migration 15). The number itself is private. */
  phone_verified?: boolean;
  created_at: string;
};

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type BusinessHours = {
  /** always = open 24 hours, appointment = by appointment only, custom = the days below */
  mode: 'always' | 'appointment' | 'custom';
  days: Record<WeekDay, { open: boolean; from: string; to: string }>;
};
/** WhatsApp Business-style details (business_profiles, migration 21). Name and photo stay on the profile. */
export type BusinessProfile = {
  user_id: string;
  cover_url: string | null;
  status_text: string | null;
  description: string | null;
  address: string | null;
  coverage_area: string | null;
  location_notes: string | null;
  hours: BusinessHours | null;
  category: string | null;
  websites: string[];
  email: string | null;
  phone: string | null;
  updated_at: string;
};
export type BusinessProfilePatch = Omit<BusinessProfile, 'user_id' | 'updated_at'>;

/** Public subset shown next to posts/comments. */
export type PublicProfile = Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'account_type' | 'is_verified' | 'status'>;

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

export type ReportTarget = 'post' | 'comment' | 'user' | 'venue' | 'event' | 'review' | 'status' | 'message';
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
  /** A photo / video snap (migration 15) or a voice note (migration 16). */
  media_url?: string | null;
  media_type?: 'image' | 'video' | 'audio' | null;
  /** Voice notes only (migration 16): length and up to 64 waveform bars (0-100). */
  media_duration_ms?: number | null;
  media_waveform?: number[] | null;
  /** Migration 19: the message this one replies to (same chat), and whether it was forwarded. */
  reply_to_id?: string | null;
  is_forwarded?: boolean;
};
export type MessageMedia =
  | { media_url: string; media_type: 'image' | 'video' }
  | { media_url: string; media_type: 'audio'; media_duration_ms: number; media_waveform: number[] };
/** A reaction on a chat message (migration 19): one per person per message. */
export type MessageReaction = { message_id: string; user_id: string; emoji: string };
/** Your own chat list filters (conversation_participants, migration 15). */
export type ConversationPrefs = {
  conversation_id: string; is_favorite: boolean; is_archived: boolean;
  /** Migration 20: pinned on top of your list (max 3), and "Mark as unread". */
  is_pinned?: boolean; pinned_at?: string | null; marked_unread?: boolean;
};

// ---------------------------------------------------------------- channels (migration 15)
export type Channel = {
  id: string;
  /** The business that owns it (the database still calls businesses venues). */
  venue_id: string;
  name: string;
  description: string | null;
  follower_count: number;
  last_message_at: string | null;
  created_by: string | null;
  created_at: string;
};
export type ChannelMessage = {
  id: string;
  channel_id: string;
  author_id: string;
  body: string | null;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  created_at: string;
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
