# Pulse backend (Supabase / PostgreSQL)

Everything lives in `supabase/migrations/`. Apply in filename order (SQL editor, or `supabase db push`).

For an existing project, `supabase/upgrade_live_database.sql` is all of them in order in one file (safe to run again).

| # | File | What it does | Safe to apply now? |
|---|------|--------------|--------------------|
| 0 | `20261003125900_reconcile_live_schema.sql` | adopts a database created by an earlier build: drops/recreates owned views, relaxes old NOT NULL columns (e.g. `profiles.username`), adds and backfills missing columns, fixes `posts.status`/`media_type` defaults, converts old verification requests, removes leftover permissive policies | Yes (first) |
| 1 | `20261011100000_backend_identity_and_venues.sql` | profiles, admins, preferences, venue accounts, verification, events, status expiry | Yes |
| 1b | `20261011100500_reconcile_legacy_tables.sql` | adapts `comments`, `reviews`, `reports`, `venue_follows`, `notification_reads` left over from an earlier build (old `reports` becomes `reports_legacy`); no-op otherwise | Yes (before 2) |
| 2 | `20261011101000_backend_community.sql` | comments, reactions, follows, reviews, RSVPs, reports, notifications, moderation RPCs, Storage buckets | Yes |
| 3 | `20261011110000_backend_lockdown.sql` | removes the open anon policies on `venues`, `posts`, `saved_venues` | **Only once the frontend has sign-in** |
| 4 | `20261014100000_backend_reactions_and_snaps.sql` | emoji palette, venue vibes, camera snaps (media posts that expire after 24 h), video uploads | Yes (after 1-3) |
| 6 | `20261019100000_verification_roles.sql` | Performer / Staff role on verification requests (Manager, Host, Mc, Dj, Promoter, Musician, Dancer) | Yes (after 5) |
| 7 | `20261019110000_venue_is_live.sql` | `venues_public.is_live` (status Live, or a published event running now; never when Sold out); events in realtime | Yes (after 6) |
| 8 | `20261020100000_security_hardening.sql` | post authors can edit only `content` (no swapping `media_url` past the upload checks); venue/event image and ticket URLs must be http(s) | Yes (after 7) |
| 9 | `20261022100000_multi_venue_management.sql` | multi-venue management: `host` role on `venue_managers`; linked hosts/managers edit every linked venue's profile; `posts.as_venue` publishes as the venue (author shown as the venue, `user_id` kept) | Yes (after 8) |
| 10 | `20261022110000_admin_venue_staff.sql` | admin RPCs behind Moderation -> Staff: find a user by display name or exact email (email never returned), link/unlink them to a venue as manager or host (logged) | Yes (after 9) |
| 11 | `20261023100000_venue_logo.sql` | `venues.logo_url` (square logo / profile picture next to the `image_url` cover photo, http(s) only), editable by linked hosts/managers and admins; exposed on `venues_public` | Yes (after 10) |
| 12 | `20261024100000_register_venue.sql` | self-service venue registration: `register_venue()` lets any active signed-in user create a venue (unverified, Not active; max 3 per day; no duplicate name in the same location) and links them as its manager; `venues.created_by` | Yes (after 11) |
| 13 | `20261025100000_self_service_controls.sql` | self-service controls: drop your role (`relinquish_my_role`), leave a venue (`leave_venue`), rename or delete a venue you registered (`rename_my_venue`, `delete_my_venue`); admins delete any venue (`admin_delete_venue`, linked users told) and set anyone's role/badge (`admin_set_user_role`), both logged; `venues_public.created_by` | Yes (after 12) |

Also still required from earlier work: `20261003130000_fix_venue_locations.sql` (venue names/neighborhoods incl. Taboo - Bugolobi) and `20261003131000_profile_saved_venues_notifications.sql`.

## First-time setup

1. Apply the migrations above.
2. Make yourself an administrator (SQL editor, after you have signed up once):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'YOU@EXAMPLE.COM';
   ```
3. Dashboard -> Authentication -> URL Configuration: set the Site URL and add your redirect URLs
   (for password reset, e.g. `https://your-site/#/reset-password`).
4. Dashboard -> Database -> Extensions: enable `pg_cron` (migration 1 then schedules the status-expiry job
   automatically; re-run its `DO` block if you enable it later). Without it, expired statuses are still
   *displayed* correctly through the `venues_public` view, they just aren't flipped in storage.
5. **Pin your storage origin** (required for snaps to be fully locked down; without it the host of a media URL is not checked):
   ```sql
   insert into public.app_config (key, value) values ('storage_base_url', 'https://<project-ref>.supabase.co')
   on conflict (key) do update set value = excluded.value;
   ```
   (`http://127.0.0.1:54321` when using `supabase start`.) Snap posts must point at a file that really exists in
   `post-media/<your user id>/...` on that origin, so tracking pixels on other hosts are rejected.
6. Run `supabase/tests/rls_smoke.sql` in the SQL editor. It rolls back and prints `ALL CHECKS PASSED` (164 checks). `supabase/tests/rls_social_smoke.sql` covers migration 5 (105 checks). `supabase/tests/rls_multi_venue_smoke.sql` covers migration 9 (20 checks). `supabase/tests/rls_admin_staff_smoke.sql` covers migration 10 (21 checks). `supabase/tests/rls_venue_logo_smoke.sql` covers migration 11 (8 checks). `supabase/tests/rls_register_venue_smoke.sql` covers migration 12. `supabase/tests/rls_self_service_smoke.sql` covers migration 13.

## Accounts and roles

| Type | How you get it |
|------|----------------|
| Regular User | Sign up |
| Verified Host/MC/DJ | `verification_requests` (kind `host`) -> admin approves |
| Venue Account | `verification_requests` (kind `venue`, venue_id) -> admin approves; links the user in `venue_managers` and verifies the venue |
| Host / Venue Manager of several venues | Admin links them per venue in Moderation -> Staff (role `manager` or `host`); the user picks the venue in Profile -> My venues |
| PULSE Administrator | Row in `admins` (SQL editor only) |

Users cannot change `account_type`, `is_verified` or `status` themselves (no UPDATE privilege on those columns).

## Privacy model

- `profiles` holds only display name, avatar and bio. The email stays in `auth.users` and is never exposed.
- Sign up with `options: { data: { display_name } }`. The database rejects emails, reserved names (admin, pulse, support...) and duplicates, and falls back to a generated `pulse_xxxxxxxx` handle.
- Post/comment/review author names are stamped by triggers from the profile, so they cannot be spoofed.
- Who follows/saves what is private (own rows only); counts come from the `venue_stats` / `profile_stats` views.

## Frontend integration (done)

All database access from the app goes through `src/lib/api.ts` using the single Supabase client, which sends the
signed-in user's JWT as the `Authorization` header on every request. Signed-out visitors get the `anon` role, so
every write (post, comment, react, follow, save, report) is gated by `requireAuth()` in the UI and by RLS in the database.

Auth settings to check in the dashboard (Authentication -> URL Configuration):
- **Site URL** and **Redirect URLs** must include your app's origin (e.g. `https://your-site/` and `http://localhost:5173/`).
  The app uses the PKCE flow, so email links return as `/?code=...`; the hash stays free for `/#/manage`.
- Email confirmation on: sign-up shows "check your email". Off: the user is signed in immediately.
- Password reset: "Forgot password?" sends the reset email; the link opens the app and shows "Choose a new password".

Before deploying this frontend, apply migrations 1 and 2 (the app reads `venues_public`, reactions, notifications).
Apply migration 3 right after: the app no longer writes anonymously anywhere.

Tests (in `supabase/tests/`):
- `rls_smoke.sql`: 164 checks of RLS, triggers and RPCs (run it in the SQL editor).
- `api_smoke.mjs` + `run_api_smoke.sh`: runs `src/lib/api.ts` against a real database through PostgREST (local setup only).

## Frontend cheat sheet

| Need | Call |
|------|------|
| Venue list with *effective* status | `from('venues_public').select('*')` |
| Venue followers / rating | `from('venue_stats')` |
| Manager sets status | `rpc('set_venue_status', { p_venue_id, p_status: 'live' \| 'sold_out' \| 'not_active', p_duration_minutes: 360 })` |
| Events with phase (`upcoming` / `live_now` / `ended`) | `from('events_feed')` |
| Post | `from('posts').insert({ content, venue_id?, event_id?, media_url? })` (author, badge, counters are set by the DB) |
| Comment / react | `from('comments').insert({ post_id, body })`, `from('reactions').upsert({ post_id, kind: 'fire' \| 'heart' \| 'party' })` |
| Follow | `from('venue_follows').insert({ venue_id })`, `from('user_follows').insert({ followee_id })` |
| Save venue / RSVP | `from('saved_venues').insert({ venue_id })`, `from('event_rsvps').insert({ event_id, kind })` |
| Report | `from('reports').insert({ target_type, target_id, reason, details })` |
| Notifications | `from('notifications').select('*')`, `rpc('unread_notification_count')`, `rpc('mark_all_notifications_read')` |
| Preferences | `from('user_preferences').update({ theme, live_venue_alerts, community_alerts, announcements })` |
| Avatar upload | Storage bucket `avatars`, path `<user_id>/<file>`; then save the public URL in `profiles.avatar_url` |
| Request verification | `from('verification_requests').insert({ kind, venue_id?, message })` |
| Delete my account | `rpc('delete_my_account')` |
| Password reset / email / password change | Supabase Auth: `resetPasswordForEmail`, `updateUser` (no custom backend needed) |

### Reactions, vibes and snaps

| Need | Call |
|------|------|
| Emoji palette | `from('reaction_types').select('kind,emoji,label,sort').eq('active', true).order('sort')` (admins add/retire emojis with INSERT/UPDATE) |
| React to a post | `from('reactions').insert({ post_id, kind })`, switch with `.update({ kind })`, remove with `.delete()` (one reaction per user per post) |
| Per-emoji counts | `from('post_reaction_counts').select('post_id,kind,n')` |
| Venue vibe (last 12 h) | `from('venue_reactions').insert({ venue_id, kind })`; counts: `from('venue_vibe_counts')` |
| Upload a snap | Storage `post-media` bucket, path `<user_id>/<file>` (images + mp4/webm, 25 MB) |
| Publish a snap | `from('posts').insert({ content, kind: 'snap', media_url, media_type: 'image' \| 'video', media_width, media_height, media_duration_ms, media_meta, venue_id })`; `expires_at` is set by the database (24 h) |
| Live snaps | `from('posts').select('*').eq('kind', 'snap')` (expired ones are hidden by RLS) |
| Storage cleanup | `select * from expired_snap_paths()` (service role) -> delete those files with the Storage API on a schedule |

Realtime: `reactions`, `venue_reactions`, `posts`, `comments`, `notifications` are in the `supabase_realtime` publication.

### Engagement, statuses and messages (migration 5)

| Need | Call |
|------|------|
| Count views | `rpc('record_post_views', { p_post_ids })` (batched; own posts and repeats are ignored) |
| Bookmarks | `from('saved_posts').insert({ post_id })` / `.delete()`; list with `select('post_id, posts(*)')` |
| Reposts | `from('reposts').insert({ post_id, quote })` / `.delete()`; `posts.reposts` is kept by triggers |
| Follow a person | `from('user_follows').insert({ followee_id })` / `.delete()` |
| Profile numbers | `from('profile_stats')` (followers, following, posts, `vibe_rep`) |
| Statuses | `from('statuses').insert({ media_url, media_type, caption, venue_id })` (24 h, expired ones hidden by RLS), `from('status_views')`, `rpc('admin_delete_status')` |
| Start a chat | `rpc('get_or_create_conversation', { p_other })` |
| Messages | `from('messages').insert({ conversation_id, body, ref_type, ref_id })`, `rpc('mark_conversation_read', { p_conv })`, `rpc('unread_message_count')`, `rpc('list_conversations')` |
| Secret mode | `rpc('set_vanish_mode', { p_conv, p_on })`. Messages sent while on get `expires_at` when read (`app_config.vanish_seconds`); RLS hides expired rows and `rpc('purge_expired_messages')` deletes them (schedule it with pg_cron). |

As everywhere else, the client never sends `user_id`: triggers stamp it from `auth.uid()`.

### Running the tests

- SQL: apply `tests/00_supabase_stubs.sql` and all migrations to a scratch Postgres, then run `tests/rls_smoke.sql` and `tests/rls_social_smoke.sql`.
- API: `tests/run_api_smoke.sh` (needs PostgREST; 152 checks).
- Browser: `tests/e2e/run.sh` (real Chromium + built app + PostgREST; 60 checks). Supabase Realtime is not part of these runs.

### Admin (`/#/manage`)

`from('admin_report_queue')` (moderation queue), `rpc('admin_resolve_report', { p_report_id, p_action: 'actioned' | 'dismissed', p_note, p_remove_content })`,
`rpc('admin_set_content_status', { p_type: 'post' | 'comment' | 'review', p_id, p_status: 'removed' | 'visible' })`,
`rpc('admin_set_user_status', { p_user_id, p_status: 'active' | 'suspended' | 'banned', p_reason })` (a ban also blocks sign-in),
`rpc('admin_review_verification', { p_request_id, p_approve, p_note })`,
`rpc('admin_create_venue' | 'admin_update_venue', ...)`, `from('moderation_log')`.

## Notes and limits

- Live/Sold out always have an expiry (default 6 h, 15 min to 12 h via `set_venue_status`). Existing "live"/"busy" venues were migrated to Live with a 6 h expiry; "quiet" became Not active.
- The Official badge needs *both* a venue manager and an admin-verified venue.
- Rate limits: 10 posts and 20 comments per user per 10 minutes.
- `delete_my_account()` removes the account and all their rows; files they uploaded to Storage are not deleted automatically.
- Old device-based `saved_venues` rows stay in the table but are unreachable after migration 3.
- Not included yet: Moments (short video), map discovery, and Phase 3 (subscriptions, ticketing, table booking, analytics).
