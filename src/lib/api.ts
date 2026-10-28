/**
 * Typed data layer for Pulse. Every call goes through the single Supabase client,
 * which attaches the signed-in user's JWT (Authorization: Bearer ...) automatically.
 * Row-level security in the database decides what that user may read or write.
 *
 * This file deliberately has no import of the app's Supabase singleton so it can
 * be exercised from Node (see scripts/api-smoke.mjs).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Post, Comment, ReactionKind, ReactionCounts, ReactionType, NewPostInput, Profile, PublicProfile, Preferences,
  AppNotification, ReportTarget, ReportReason, ReportRow, VerificationRequest, ModerationLogRow, AccountStatus, AccountType,
  ProfileStats, Status, NewStatusInput, ChatMessage, ConversationSummary, MessageRef, MessageMedia, ConversationPrefs, Channel, ChannelMessage, BusinessProfile, BusinessProfilePatch, VerificationRole, MessageReaction,
} from './types';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

function unwrap<T>(res: Res<T>): T {
  if (res.error) throw new ApiError(res.error.message, res.error.code);
  return res.data as T;
}

/** PostgREST/Postgres codes for "no such table/view/function": the database is missing a migration. */
const MISSING_SCHEMA_CODES = new Set(['PGRST205', 'PGRST202', '42P01', '42883']);

export function isMissingSchema(e: unknown): boolean {
  return MISSING_SCHEMA_CODES.has((e as { code?: string })?.code ?? '');
}

const warnedMissing = new Set<string>();

/** Postgres / PostgREST "no such column": a newer column is not in the database yet. */
const isMissingColumn = (e: unknown) => ['42703', 'PGRST204'].includes((e as { code?: string })?.code ?? '');

const MSG_COLS = 'id, conversation_id, sender_id, body, kind, ref_type, ref_id, vanish, created_at, read_at, expires_at';
// chat snaps (migration 15), voice notes (migration 16), replies (migration 19); each level is dropped for the rest of the session
// if the database does not have those columns yet
const MSG_MEDIA_LEVELS = [
  MSG_COLS,
  `${MSG_COLS}, media_url, media_type`,
  `${MSG_COLS}, media_url, media_type, media_duration_ms, media_waveform`,
  // replies and forwarding (migration 19)
  `${MSG_COLS}, media_url, media_type, media_duration_ms, media_waveform, reply_to_id, is_forwarded`,
];
let msgMediaLevel = MSG_MEDIA_LEVELS.length - 1;
const msgCols = () => MSG_MEDIA_LEVELS[msgMediaLevel];

// Profiles are read column by column, never with "*": private columns (a phone number, a real name) can be hidden from
// the API (migration 18), and "*" would then fail. phone_verified arrives with migration 15.
const PROFILE_BASE = 'id, display_name, avatar_url, bio, account_type, is_verified, status, created_at';
let profilePhoneFlag = true;
const profileCols = () => (profilePhoneFlag ? `${PROFILE_BASE}, phone_verified` : PROFILE_BASE);

/** Voice notes are private: `<conversation>/<sender>/<file>` in the message-media bucket, played through signed URLs. */
const VOICE_BUCKET = 'message-media';
const voicePath = (url: string) => {
  const m = /\/storage\/v1\/object\/(?:authenticated|sign|public)\/message-media\/([^?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};
const SIGNED_TTL_S = 6 * 3600;
const signedCache = new Map<string, { url: string; until: number }>();

/**
 * Like unwrap, but for reads of optional features: if the backing table or function does not exist yet
 * (migration not applied), return `fallback` so the screen shows an empty state instead of an error.
 */
function unwrapOr<T>(res: Res<T>, fallback: T): T {
  if (res.error && isMissingSchema(res.error)) {
    if (!warnedMissing.has(res.error.message)) {
      warnedMissing.add(res.error.message);
      console.warn(`[pulse] ${res.error.message}. Apply the pending migrations in supabase/migrations.`);
    }
    return fallback;
  }
  return unwrap(res) ?? fallback;
}

/** Friendly text for the most common database errors. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const msg = err?.message ?? 'Something went wrong';
  // our own "needs migration N" messages say exactly what is missing
  if (/database update \(migration \d+\)/i.test(msg)) return msg;
  if (isMissingSchema(err) || isMissingColumn(err)) return 'This feature is not available yet.';
  // why a chat message was refused (messages triggers and policies)
  if (/recipient unavailable/i.test(msg)) return 'You cannot message this person right now.';
  if (/only pin up to 3 chats/i.test(msg)) return 'You can only pin up to 3 chats.';
  if (/conversation not found/i.test(msg)) return 'This chat no longer exists.';
  if (/only reply to a message of this chat/i.test(msg)) return 'The message you replied to is not in this chat any more.';
  if (/message-media folder|upload it before sending/i.test(msg)) return 'The voice message did not upload. Please record it again.';
  if (/row-level security policy for table "messages"/i.test(msg)) return 'You cannot send messages in this chat.';
  if (err?.code === '23505') return 'That already exists.';
  if (/slow down/i.test(msg)) return 'You are doing that too fast. Please wait a few minutes.';
  if (/own post-media folder|not found in storage/i.test(msg)) return 'Upload failed. Please try again.';
  if (/mime type|not supported|payload too large|exceeded the maximum/i.test(msg)) return 'That file is too large or in an unsupported format.';
  if (/account is not active/i.test(msg)) return 'Your account is suspended, so you can read but not post.';
  if (/sign in required/i.test(msg) || /JWT/i.test(msg)) return 'Please sign in first.';
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
  return msg;
}

export function createApi(c: SupabaseClient) {
  return {

    // ------------------------------------------------------------- posts
    async listPosts(limit = 50) {
      return unwrap(
        await c.from('posts').select('*').eq('status', 'visible').order('created_at', { ascending: false }).limit(limit)
      ) as Post[];
    },
    async createPost(input: NewPostInput) {
      const row: Record<string, unknown> = { content: input.content.trim() };
      if (input.venue_id) row.venue_id = input.venue_id;
      if (input.as_venue) row.as_venue = true;
      for (const k of ['kind', 'media_url', 'media_type', 'media_width', 'media_height', 'media_duration_ms', 'media_meta'] as const) {
        if (input[k] !== undefined) row[k] = input[k];
      }
      return unwrap(await c.from('posts').insert(row).select().single()) as Post;
    },
    /** Camera snaps that are still live (RLS hides expired ones), newest first. */
    async listSnaps(limit = 30) {
      return unwrap(
        await c.from('posts').select('*').eq('kind', 'snap').eq('status', 'visible').order('created_at', { ascending: false }).limit(limit)
      ) as Post[];
    },
    /** Upload a photo/video blob to the public post-media bucket (inside the user's own folder). */
    async uploadPostMedia(userId: string, blob: Blob, ext: string) {
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      // Strip codec parameters ("video/webm;codecs=vp9,opus"): the multipart upload uses the blob's own type,
      // and the bucket's mime allow-list compares the plain type.
      const contentType = (blob.type || 'application/octet-stream').split(';')[0];
      const body = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
      let lastError: { message: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const up = await c.storage.from('post-media').upload(path, body, { contentType, upsert: false, cacheControl: '86400' });
        if (!up.error) return c.storage.from('post-media').getPublicUrl(path).data.publicUrl;
        lastError = up.error;
      }
      throw new ApiError(lastError?.message ?? 'Upload failed');
    },
    /** Deleting your own post also removes its photo / video from your post-media folder (best effort). */
    async deletePost(id: string, mediaUrl?: string | null) {
      unwrap(await c.from('posts').delete().eq('id', id));
      const path = mediaUrl?.split('/post-media/')[1]?.split('?')[0];
      if (path) await c.storage.from('post-media').remove([decodeURIComponent(path)]).catch(() => undefined);
    },
    /** Authors edit the text of their own posts (media stays as posted). */
    async updatePost(id: string, content: string) {
      const rows = unwrap(await c.from('posts').update({ content: content.trim() }).eq('id', id).select('id')) as unknown[];
      if (rows.length === 0) throw new ApiError('You can only edit your own posts.', '42501');
    },

    async profilesByIds(ids: string[]) {
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) return {} as Record<string, PublicProfile>;
      const rows = unwrap(
        await c.from('profiles').select('id, display_name, avatar_url, account_type, is_verified, status').in('id', unique)
      ) as PublicProfile[];
      return Object.fromEntries(rows.map((r) => [r.id, r]));
    },

    // --------------------------------------------------------- reactions
    async reactionCounts(postIds: string[]) {
      const out: Record<string, ReactionCounts> = {};
      if (postIds.length === 0) return out;
      const rows = unwrap(
        await c.from('post_reaction_counts').select('post_id, kind, n').in('post_id', postIds)
      ) as { post_id: string; kind: ReactionKind; n: number }[];
      for (const r of rows) (out[r.post_id] ??= {})[r.kind] = r.n;
      return out;
    },
    async myReactions(userId: string, postIds: string[]) {
      const out: Record<string, ReactionKind> = {};
      if (postIds.length === 0) return out;
      const rows = unwrap(
        await c.from('reactions').select('post_id, kind').eq('user_id', userId).in('post_id', postIds)
      ) as { post_id: string; kind: ReactionKind }[];
      for (const r of rows) out[r.post_id] = r.kind;
      return out;
    },
    /** Tap same emoji = remove, different emoji = switch, none yet = add. Returns the new state. */
    async setReaction(postId: string, userId: string, kind: ReactionKind, current: ReactionKind | null) {
      if (current === kind) {
        unwrap(await c.from('reactions').delete().eq('post_id', postId).eq('user_id', userId));
        return null;
      }
      if (current) {
        unwrap(await c.from('reactions').update({ kind }).eq('post_id', postId).eq('user_id', userId));
      } else {
        unwrap(await c.from('reactions').insert({ post_id: postId, kind }));
      }
      return kind;
    },

    /** The emoji palette (active reactions, in display order). */
    async listReactionTypes() {
      return unwrap(
        await c.from('reaction_types').select('kind, emoji, label, sort').eq('active', true).order('sort', { ascending: true })
      ) as ReactionType[];
    },


    // ---------------------------------------------------------- comments
    async listComments(postId: string) {
      return unwrap(
        await c.from('comments').select('id, post_id, user_id, user_name, body, created_at')
          .eq('post_id', postId).eq('status', 'visible').order('created_at', { ascending: true }).limit(200)
      ) as Comment[];
    },
    async addComment(postId: string, body: string) {
      return unwrap(
        await c.from('comments').insert({ post_id: postId, body: body.trim() })
          .select('id, post_id, user_id, user_name, body, created_at').single()
      ) as Comment;
    },
    async deleteComment(id: string) {
      unwrap(await c.from('comments').delete().eq('id', id));
    },
    async updateComment(id: string, body: string) {
      const rows = unwrap(await c.from('comments').update({ body: body.trim() }).eq('id', id).select('id')) as unknown[];
      if (rows.length === 0) throw new ApiError('You can only edit your own comments.', '42501');
    },

    // ----------------------------------------------------------- reports
    async createReport(input: { target_type: ReportTarget; target_id: string; reason: ReportReason; details?: string }) {
      const row: { target_type: ReportTarget; target_id: string; reason: ReportReason; details?: string } = {
        target_type: input.target_type, target_id: input.target_id, reason: input.reason,
      };
      if (input.details?.trim()) row.details = input.details.trim();
      unwrap(await c.from('reports').insert(row));
    },


    // ----------------------------------------------- profile & preferences
    async getProfile(userId: string) {
      const read = () => c.from('profiles').select(profileCols()).eq('id', userId).maybeSingle();
      let res = await read();
      if (res.error && profilePhoneFlag && isMissingColumn(res.error)) { profilePhoneFlag = false; res = await read(); }
      return unwrap(res) as unknown as Profile | null;
    },
    async updateProfile(userId: string, patch: { display_name?: string; bio?: string | null; avatar_url?: string | null }) {
      const write = () => c.from('profiles').update(patch).eq('id', userId).select(profileCols());
      let res = await write();
      if (res.error && profilePhoneFlag && isMissingColumn(res.error)) { profilePhoneFlag = false; res = await write(); }
      const rows = unwrap(res) as unknown as Profile[];
      if (rows.length === 0) throw new ApiError('Profile not found');
      return rows[0];
    },
    async isDisplayNameTaken(name: string, exceptUserId?: string) {
      // escape LIKE wildcards so the name is matched literally (case-insensitive)
      const escaped = name.trim().replace(/[\\%_]/g, (m) => '\\' + m);
      let q = c.from('profiles').select('id').ilike('display_name', escaped).limit(1);
      if (exceptUserId) q = q.neq('id', exceptUserId);
      return unwrap(await q).length > 0;
    },
    async uploadAvatar(userId: string, file: File) {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const up = await c.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new ApiError(up.error.message);
      const url = c.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      return url;
    },
    async isAdmin(userId: string) {
      const row = unwrap(await c.from('admins').select('user_id').eq('user_id', userId).maybeSingle());
      return row !== null;
    },
    async getPreferences(userId: string) {
      return unwrap(
        await c.from('user_preferences').select('theme, live_venue_alerts, community_alerts, announcements').eq('user_id', userId).maybeSingle()
      ) as Preferences | null;
    },
    async savePreferences(userId: string, patch: Partial<Preferences>) {
      const rows = unwrap(await c.from('user_preferences').update(patch).eq('user_id', userId).select('user_id')) as unknown[];
      if (rows.length === 0) unwrap(await c.from('user_preferences').insert({ user_id: userId, ...patch }));
    },
    async deleteMyAccount() {
      unwrap(await c.rpc('delete_my_account'));
    },

    // -------------------------------------------- business profile (migration 21)
    /** Null when there is no row yet; throws a missing-schema error before migration 21. */
    async getBusinessProfile(userId: string) {
      return unwrap(await c.from('business_profiles').select('*').eq('user_id', userId).maybeSingle()) as BusinessProfile | null;
    },
    /** Update your row, or create it the first time (update is tried first: user_id itself can not be updated). */
    async saveBusinessProfile(userId: string, patch: BusinessProfilePatch) {
      const updated = unwrap(await c.from('business_profiles').update(patch).eq('user_id', userId).select('*')) as BusinessProfile[];
      if (updated.length > 0) return updated[0];
      return unwrap(await c.from('business_profiles').insert({ user_id: userId, ...patch }).select('*').single()) as BusinessProfile;
    },

    // ----------------------------------------------------- notifications
    async listNotifications(limit = 50) {
      return unwrap(
        await c.from('notifications').select('id, title, body, type, venue_id, post_id, created_at').order('created_at', { ascending: false }).limit(limit)
      ) as AppNotification[];
    },
    async listReadNotificationIds(userId: string) {
      const rows = unwrap(await c.from('notification_reads').select('notification_id').eq('user_id', userId)) as { notification_id: string }[];
      return rows.map((r) => r.notification_id);
    },
    async markNotificationRead(id: string) {
      const res = await c.from('notification_reads').insert({ notification_id: id });
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    async markAllNotificationsRead() {
      unwrap(await c.rpc('mark_all_notifications_read'));
    },

    // ------------------------------------------- roles & verification
    /** The businesses you run (each can own one channel). The database still calls them venues. */
    async managedVenueIds(userId: string) {
      const rows = unwrap(await c.from('venue_managers').select('venue_id').eq('user_id', userId)) as { venue_id: string }[];
      return rows.map((r) => r.venue_id);
    },
    // migration 13: self-service roles
    /** Drop your Performer / Staff or business account role and its badge. */
    async relinquishMyRole() {
      return unwrap(await c.rpc('relinquish_my_role')) as Profile;
    },
    /** Ask to be verified in a Performer / Staff role. */
    async requestVerification(input: { kind: 'host'; role: VerificationRole; message?: string }) {
      unwrap(await c.from('verification_requests').insert({ kind: input.kind, role: input.role, message: input.message?.trim() || undefined }));
    },
    async myVerificationRequests(userId: string) {
      return unwrap(
        await c.from('verification_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      ) as VerificationRequest[];
    },

    // ----------------------------------------- engagement: views, bookmarks, reposts
    async getPost(id: string) {
      return unwrap(await c.from('posts').select('*').eq('id', id).eq('status', 'visible').maybeSingle()) as Post | null;
    },
    /** Count first-time views (signed-in viewers other than the author). Up to 50 ids per call. */
    async recordPostViews(postIds: string[]) {
      const ids = [...new Set(postIds)].slice(0, 50);
      if (ids.length === 0) return 0;
      return unwrapOr(await c.rpc('record_post_views', { p_post_ids: ids }), 0) as number;
    },
    async savedPostIds(userId: string) {
      const rows = unwrapOr(await c.from('saved_posts').select('post_id').eq('user_id', userId), []) as { post_id: string }[];
      return rows.map((r) => r.post_id);
    },
    async savePost(postId: string) {
      const res = await c.from('saved_posts').insert({ post_id: postId });
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    async unsavePost(userId: string, postId: string) {
      unwrap(await c.from('saved_posts').delete().eq('user_id', userId).eq('post_id', postId));
    },
    /** Posts the user bookmarked, newest bookmark first (removed/expired posts drop out by themselves). */
    async listSavedPosts(userId: string) {
      const saved = unwrapOr(
        await c.from('saved_posts').select('post_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
        [],
      ) as { post_id: string; created_at: string }[];
      if (saved.length === 0) return [] as Post[];
      const posts = unwrap(await c.from('posts').select('*').in('id', saved.map((s) => s.post_id)).eq('status', 'visible')) as Post[];
      const byId = new Map(posts.map((p) => [p.id, p]));
      return saved.map((s) => byId.get(s.post_id)).filter((p): p is Post => !!p);
    },
    async myRepostIds(userId: string, postIds: string[]) {
      if (postIds.length === 0) return [] as string[];
      const rows = unwrapOr(await c.from('reposts').select('post_id').eq('user_id', userId).in('post_id', postIds), []) as { post_id: string }[];
      return rows.map((r) => r.post_id);
    },
    async repost(postId: string, comment?: string) {
      const row: { post_id: string; comment?: string } = { post_id: postId };
      if (comment?.trim()) row.comment = comment.trim();
      const res = await c.from('reposts').insert(row);
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    async unrepost(userId: string, postId: string) {
      unwrap(await c.from('reposts').delete().eq('user_id', userId).eq('post_id', postId));
    },

    // ----------------------------------------- people: stats, follow
    async profileStats(userId: string) {
      return unwrapOr(await c.from('profile_stats').select('*').eq('user_id', userId).maybeSingle(), null) as ProfileStats | null;
    },
    async isFollowingUser(myId: string, otherId: string) {
      const rows = unwrapOr(await c.from('user_follows').select('followee_id').eq('follower_id', myId).eq('followee_id', otherId), []) as unknown[];
      return rows.length > 0;
    },
    async followUser(otherId: string) {
      const res = await c.from('user_follows').insert({ followee_id: otherId });
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    async unfollowUser(myId: string, otherId: string) {
      unwrap(await c.from('user_follows').delete().eq('follower_id', myId).eq('followee_id', otherId));
    },

    // ----------------------------------------- statuses (24 h stories)
    /** Every live status, oldest first (so a person's stories play in the order they were posted). */
    async listStatuses() {
      return unwrapOr(
        await c.from('statuses').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }).limit(300),
        [],
      ) as Status[];
    },
    async createStatus(input: NewStatusInput) {
      const row: Record<string, unknown> = { media_url: input.media_url, media_type: input.media_type };
      if (input.caption?.trim()) row.caption = input.caption.trim();
      if (input.venue_id) row.venue_id = input.venue_id;
      return unwrap(await c.from('statuses').insert(row).select().single()) as Status;
    },
    async getStatus(id: string) {
      return unwrap(await c.from('statuses').select('*').eq('id', id).maybeSingle()) as Status | null;
    },
    async deleteStatus(id: string) {
      unwrap(await c.from('statuses').delete().eq('id', id));
    },
    /** Admins: remove someone's status; the author is told why (logged). */
    async adminDeleteStatus(id: string, note?: string) {
      unwrap(await c.rpc('admin_delete_status', { p_id: id, p_note: note?.trim() || null }));
    },
    async myStatusViews(userId: string) {
      const rows = unwrapOr(await c.from('status_views').select('status_id').eq('viewer_id', userId), []) as { status_id: string }[];
      return rows.map((r) => r.status_id);
    },
    async markStatusViewed(statusId: string) {
      const res = await c.from('status_views').insert({ status_id: statusId });
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    /** The owner sees everyone who viewed the status; anyone else only sees their own row. */
    async statusViewers(statusId: string) {
      return unwrap(
        await c.from('status_views').select('viewer_id, viewed_at').eq('status_id', statusId).order('viewed_at', { ascending: false }).limit(200)
      ) as { viewer_id: string; viewed_at: string }[];
    },

    // ----------------------------------------- channels (migration 15; each belongs to a business, venue_id)
    /** Every channel, most recently active first. Empty before migration 15. */
    async listChannels() {
      return unwrapOr(
        await c.from('venue_channels').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).order('name').limit(500),
        [],
      ) as Channel[];
    },
    async createChannel(ownerId: string, name: string, description?: string | null) {
      return unwrap(
        await c.from('venue_channels').insert({ venue_id: ownerId, name: name.trim(), description: description?.trim() || null }).select().single()
      ) as Channel;
    },
    async updateChannel(channelId: string, patch: { name?: string; description?: string | null }) {
      return unwrap(await c.from('venue_channels').update(patch).eq('id', channelId).select().single()) as Channel;
    },
    async myChannelFollows(userId: string) {
      const rows = unwrapOr(await c.from('channel_followers').select('channel_id').eq('user_id', userId), []) as { channel_id: string }[];
      return rows.map((r) => r.channel_id);
    },
    async followChannel(channelId: string) {
      const res = await c.from('channel_followers').insert({ channel_id: channelId });
      if (res.error && res.error.code !== '23505') throw new ApiError(res.error.message, res.error.code);
    },
    async unfollowChannel(channelId: string, userId: string) {
      unwrap(await c.from('channel_followers').delete().eq('channel_id', channelId).eq('user_id', userId));
    },
    /** Latest posts of a channel, oldest first. */
    async listChannelMessages(channelId: string, limit = 100) {
      const rows = unwrap(
        await c.from('channel_messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: false }).limit(limit)
      ) as ChannelMessage[];
      return rows.reverse();
    },
    /** The channel's team only (RLS). Text, a photo / video, or both. */
    async postChannelMessage(channelId: string, input: { body?: string | null; media?: MessageMedia | null }) {
      const row: Record<string, unknown> = { channel_id: channelId, body: input.body?.trim() || null };
      if (input.media) { row.media_url = input.media.media_url; row.media_type = input.media.media_type; }
      return unwrap(await c.from('channel_messages').insert(row).select().single()) as ChannelMessage;
    },
    /** What you posted to these channels, newest first (Business broadcast > Past broadcasts). */
    async myChannelPosts(userId: string, channelIds: string[], limit = 30) {
      if (channelIds.length === 0) return [] as ChannelMessage[];
      return unwrap(
        await c.from('channel_messages').select('*').in('channel_id', channelIds).eq('author_id', userId).order('created_at', { ascending: false }).limit(limit)
      ) as ChannelMessage[];
    },
    async deleteChannelMessage(id: string) {
      const rows = unwrap(await c.from('channel_messages').delete().eq('id', id).select('id')) as unknown[];
      if (rows.length === 0) throw new ApiError('You can not delete this post.', '42501');
    },
    /** Your own media: snaps you posted and your live statuses, newest first. */
    async myMedia(userId: string) {
      const [posts, statuses] = await Promise.all([
        unwrapOr(
          await c.from('posts').select('id, media_url, media_type, content, created_at').eq('user_id', userId).not('media_url', 'is', null)
            .order('created_at', { ascending: false }).limit(60),
          [],
        ) as { id: string; media_url: string; media_type: 'image' | 'video'; content: string | null; created_at: string }[],
        unwrapOr(
          await c.from('statuses').select('id, media_url, media_type, caption, created_at').eq('user_id', userId)
            .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
          [],
        ) as { id: string; media_url: string; media_type: 'image' | 'video'; caption: string | null; created_at: string }[],
      ]);
      return [
        ...posts.map((p) => ({ id: p.id, source: 'post' as const, media_url: p.media_url, media_type: p.media_type, caption: p.content, created_at: p.created_at })),
        ...statuses.map((s) => ({ id: s.id, source: 'status' as const, media_url: s.media_url, media_type: s.media_type, caption: s.caption, created_at: s.created_at })),
      ].sort((x, y) => y.created_at.localeCompare(x.created_at));
    },

    // ----------------------------------------- direct messages
    async startConversation(otherUserId: string) {
      return unwrap(await c.rpc('get_or_create_conversation', { p_other: otherUserId })) as string;
    },
    async listConversations() {
      return unwrapOr(await c.rpc('list_conversations'), []) as ConversationSummary[];
    },
    async getConversation(id: string) {
      type Conv = { id: string; vanish_mode: boolean; pinned_message_id?: string | null };
      const res = await c.from('conversations').select('id, vanish_mode, pinned_message_id').eq('id', id).maybeSingle();
      // pinned messages arrive with migration 19
      if (res.error && isMissingColumn(res.error)) return unwrap(await c.from('conversations').select('id, vanish_mode').eq('id', id).maybeSingle()) as Conv | null;
      return unwrap(res) as Conv | null;
    },
    /** Reactions, your stars and your "deleted for me" for these messages (empty before migration 19). */
    async messageExtras(messageIds: string[]) {
      if (messageIds.length === 0) return { reactions: [] as MessageReaction[], starred: [] as string[], hidden: [] as string[] };
      const [r, s, h] = await Promise.all([
        c.from('message_reactions').select('message_id, user_id, emoji').in('message_id', messageIds),
        c.from('message_stars').select('message_id').in('message_id', messageIds),
        c.from('message_hidden').select('message_id').in('message_id', messageIds),
      ]);
      return {
        reactions: unwrapOr(r, []) as MessageReaction[],
        starred: (unwrapOr(s, []) as { message_id: string }[]).map((x) => x.message_id),
        hidden: (unwrapOr(h, []) as { message_id: string }[]).map((x) => x.message_id),
      };
    },
    /** One reaction per person per message: set, change, or (null) take it back. */
    async setMessageReaction(messageId: string, userId: string, emoji: string | null) {
      if (emoji === null) {
        unwrap(await c.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId));
        return;
      }
      const ins = await c.from('message_reactions').insert({ message_id: messageId, emoji });
      if (ins.error?.code === '23505') {
        unwrap(await c.from('message_reactions').update({ emoji }).eq('message_id', messageId).eq('user_id', userId));
        return;
      }
      if (ins.error && isMissingSchema(ins.error)) throw new ApiError('Reactions need the latest database update (migration 19).', ins.error.code);
      unwrap(ins);
    },
    async setMessageStar(messageId: string, userId: string, on: boolean) {
      const res = on
        ? await c.from('message_stars').insert({ message_id: messageId })
        : await c.from('message_stars').delete().eq('message_id', messageId).eq('user_id', userId);
      if (res.error && isMissingSchema(res.error)) throw new ApiError('Starred messages need the latest database update (migration 19).', res.error.code);
      if (res.error && res.error.code !== '23505') unwrap(res);
    },
    /** Delete for me: hidden for you only. */
    async hideMessage(messageId: string) {
      const res = await c.from('message_hidden').insert({ message_id: messageId });
      if (res.error && isMissingSchema(res.error)) throw new ApiError('Delete for me needs the latest database update (migration 19).', res.error.code);
      if (res.error && res.error.code !== '23505') unwrap(res);
    },
    /** Delete for everyone: only your own messages. */
    async deleteMessage(messageId: string) {
      const rows = unwrap(await c.from('messages').delete().eq('id', messageId).select('id')) as unknown[];
      if (rows.length === 0) throw new ApiError('You can only delete your own messages for everyone.', '42501');
    },
    async setPinnedMessage(conversationId: string, messageId: string | null) {
      const res = await c.rpc('set_pinned_message', { p_conv: conversationId, p_message: messageId });
      if (res.error && isMissingSchema(res.error)) throw new ApiError('Pinning needs the latest database update (migration 19).', res.error.code);
      unwrap(res);
    },
    /** Your starred messages in one chat, newest first. */
    async starredMessages(conversationId: string) {
      const res = await c.from('message_stars').select('message_id, created_at, messages!inner(id, body, sender_id, created_at, conversation_id)')
        .eq('messages.conversation_id', conversationId).order('created_at', { ascending: false });
      type Row = { message_id: string; messages: Pick<ChatMessage, 'id' | 'body' | 'sender_id' | 'created_at'> };
      return (unwrapOr(res, []) as unknown as Row[]).map((r) => r.messages);
    },
    /** Latest messages of a conversation, oldest first. Expired vanish messages are already hidden by the database. */
    /** `before`: only messages older than this time (loading earlier history page by page). */
    async listMessages(conversationId: string, limit = 100, before?: string): Promise<ChatMessage[]> {
      const read = () => {
        let q = c.from('messages').select(msgCols()).eq('conversation_id', conversationId);
        if (before) q = q.lt('created_at', before);
        return q.order('created_at', { ascending: false }).limit(limit);
      };
      let res = await read();
      while (res.error && msgMediaLevel > 0 && isMissingColumn(res.error)) {
        msgMediaLevel--;
        res = await read();
      }
      return (unwrap(res) as unknown as ChatMessage[]).reverse();
    },
    /**
     * The database stamps sender, time, vanish flag and expiry; the client sends text, an optional post/status
     * reference and an optional photo / video snap (migration 15) or voice note (migration 16).
     */
    async sendMessage(conversationId: string, body: string, ref?: MessageRef | null, media?: MessageMedia | null,
      opts: { replyToId?: string | null; forwarded?: boolean } = {}): Promise<ChatMessage> {
      const row: Record<string, unknown> = { conversation_id: conversationId, body: body.trim() };
      if (opts.replyToId) row.reply_to_id = opts.replyToId;
      if (opts.forwarded) row.is_forwarded = true;
      if (ref) { row.ref_type = ref.type; row.ref_id = ref.id; }
      if (media) { row.media_url = media.media_url; row.media_type = media.media_type; }
      if (media?.media_type === 'audio') { row.media_duration_ms = Math.round(media.media_duration_ms); row.media_waveform = media.media_waveform; }
      const write = () => c.from('messages').insert(row).select(msgCols()).single();
      let res = await write();
      if (res.error && (isMissingColumn(res.error) || /media_type_ck/.test(res.error.message))) {
        if (opts.replyToId || opts.forwarded) throw new ApiError('Replies and forwarding need the latest database update (migration 19).', res.error.code);
        if (media?.media_type === 'audio') throw new ApiError('Voice messages need the latest database update (migration 16).', res.error.code);
        if (media) throw new ApiError('Sending snaps in chats needs the latest database update (migration 15).', res.error.code);
        while (res.error && msgMediaLevel > 0 && isMissingColumn(res.error)) { msgMediaLevel--; res = await write(); }
      }
      return unwrap(res) as unknown as ChatMessage;
    },
    /** Upload a recorded voice note into your folder of this chat; returns the (private) object URL to store on the message. */
    async uploadVoiceNote(conversationId: string, userId: string, blob: Blob, ext: string) {
      const path = `${conversationId}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      // the bucket's mime allow-list compares the plain type ("audio/webm", not "audio/webm;codecs=opus")
      const contentType = (blob.type || 'audio/webm').split(';')[0];
      const body = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
      let lastError: { message: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const up = await c.storage.from(VOICE_BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: '86400' });
        if (!up.error) {
          return c.storage.from(VOICE_BUCKET).getPublicUrl(path).data.publicUrl.replace('/object/public/', '/object/authenticated/');
        }
        if (/bucket not found/i.test(up.error.message)) throw new ApiError('Voice messages need the latest database update (migration 16).');
        lastError = up.error;
      }
      throw new ApiError(lastError?.message ?? 'Upload failed');
    },
    /** A playable URL for a voice note (signed for 6 hours, cached; other URLs come back unchanged). */
    async voiceNoteUrl(url: string) {
      const path = voicePath(url);
      if (!path) return url;
      const hit = signedCache.get(path);
      if (hit && hit.until > Date.now()) return hit.url;
      const signed = unwrap(await c.storage.from(VOICE_BUCKET).createSignedUrl(path, SIGNED_TTL_S)) as { signedUrl: string };
      signedCache.set(path, { url: signed.signedUrl, until: Date.now() + (SIGNED_TTL_S - 300) * 1000 });
      return signed.signedUrl;
    },
    /** Favorites / Archived for your own chat list. Empty before migration 15. */
    async myConversationPrefs(userId: string) {
      const read = (cols: string) => c.from('conversation_participants').select(cols).eq('user_id', userId);
      let res = await read('conversation_id, is_favorite, is_archived, is_pinned, pinned_at, marked_unread');
      // pinned / marked unread arrive with migration 20; favorites / archived with migration 15
      if (res.error && isMissingColumn(res.error)) res = await read('conversation_id, is_favorite, is_archived');
      if (res.error && isMissingColumn(res.error)) return [] as ConversationPrefs[];
      return unwrapOr(res, []) as unknown as ConversationPrefs[];
    },
    async setConversationPrefs(conversationId: string, userId: string,
      patch: Partial<Pick<ConversationPrefs, 'is_favorite' | 'is_archived' | 'is_pinned' | 'marked_unread'>>) {
      const res = await c.from('conversation_participants').update(patch).eq('conversation_id', conversationId).eq('user_id', userId).select('conversation_id');
      if (res.error && isMissingColumn(res.error) && ('is_pinned' in patch || 'marked_unread' in patch)) {
        throw new ApiError('Pinning chats and Mark as unread need the latest database update (migration 20).', res.error.code);
      }
      const rows = unwrap(res) as unknown[];
      if (rows.length === 0) throw new ApiError('Could not update this chat.', '42501');
    },
    /** People you blocked (only you can see this). Empty before migration 20. */
    async myBlockedIds(userId: string) {
      return (unwrapOr(await c.from('user_blocks').select('blocked_id').eq('blocker_id', userId), []) as { blocked_id: string }[]).map((r) => r.blocked_id);
    },
    async setBlocked(userId: string, otherId: string, blocked: boolean) {
      const res = blocked
        ? await c.from('user_blocks').insert({ blocked_id: otherId })
        : await c.from('user_blocks').delete().eq('blocker_id', userId).eq('blocked_id', otherId);
      if (res.error && isMissingSchema(res.error)) throw new ApiError('Blocking needs the latest database update (migration 20).', res.error.code);
      if (res.error && res.error.code !== '23505') unwrap(res);
    },
    /** Start a chat by phone number (exact match, any formatting). Returns the profile id or null; never the number. */
    async findUserByPhone(phone: string) {
      return unwrap(await c.rpc('find_user_by_phone', { p_phone: phone })) as string | null;
    },
    async setVanishMode(conversationId: string, on: boolean) {
      return unwrap(await c.rpc('set_vanish_mode', { p_conv: conversationId, p_on: on })) as boolean;
    },
    async markConversationRead(conversationId: string) {
      return unwrap(await c.rpc('mark_conversation_read', { p_conv: conversationId })) as number;
    },
    async unreadMessageCount() {
      return unwrapOr(await c.rpc('unread_message_count'), 0) as number;
    },

    // ------------------------------------------------------------- admin
    async adminListReports(status: 'open' | 'all' = 'open') {
      let q = c.from('admin_report_queue').select('*');
      if (status === 'open') q = q.eq('status', 'open');
      return unwrap(await q.order('created_at', { ascending: false }).limit(100)) as ReportRow[];
    },
    async adminResolveReport(reportId: string, action: 'actioned' | 'dismissed', note?: string, removeContent = false) {
      unwrap(await c.rpc('admin_resolve_report', {
        p_report_id: reportId, p_action: action, p_note: note?.trim() || null, p_remove_content: removeContent,
      }));
    },
    async adminSetContentStatus(type: 'post' | 'comment' | 'review', id: string, status: 'visible' | 'removed', note?: string) {
      unwrap(await c.rpc('admin_set_content_status', { p_type: type, p_id: id, p_status: status, p_note: note?.trim() || null }));
    },
    async adminSetUserStatus(userId: string, status: AccountStatus, reason?: string) {
      unwrap(await c.rpc('admin_set_user_status', { p_user_id: userId, p_status: status, p_reason: reason?.trim() || null }));
    },
    async adminSearchUsers(query: string) {
      const escaped = query.trim().replace(/[\\%_]/g, (m) => '\\' + m);
      const list = () => {
        let q = c.from('profiles').select(profileCols()).order('created_at', { ascending: false }).limit(30);
        if (escaped) q = q.ilike('display_name', `%${escaped}%`);
        return q;
      };
      let res = await list();
      if (res.error && profilePhoneFlag && isMissingColumn(res.error)) { profilePhoneFlag = false; res = await list(); }
      return unwrap(res) as unknown as Profile[];
    },
    async adminListVerifications(status: 'pending' | 'all' = 'pending') {
      let q = c.from('verification_requests').select('*');
      if (status === 'pending') q = q.eq('status', 'pending');
      return unwrap(await q.order('created_at', { ascending: false }).limit(100)) as VerificationRequest[];
    },
    async adminReviewVerification(requestId: string, approve: boolean, note?: string) {
      unwrap(await c.rpc('admin_review_verification', { p_request_id: requestId, p_approve: approve, p_note: note?.trim() || null }));
    },
    /** Sets anyone's role and badge (logged). */
    async adminSetUserRole(userId: string, accountType: AccountType, verified: boolean) {
      return unwrap(await c.rpc('admin_set_user_role', { p_user_id: userId, p_account_type: accountType, p_verified: verified })) as Profile;
    },
    async adminModerationLog() {
      return unwrap(await c.from('moderation_log').select('*').order('created_at', { ascending: false }).limit(100)) as ModerationLogRow[];
    },
  };
}

export type Api = ReturnType<typeof createApi>;
