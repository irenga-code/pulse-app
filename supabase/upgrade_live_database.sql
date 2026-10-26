-- Pulse: full database upgrade (every migration in supabase/migrations, in order). Generated 2026-10-26.
-- Safe to run more than once. Paste into the Supabase SQL Editor and Run.

-- ============================================================================
-- >>> 20261002195207_create_venues_table.sql
-- ============================================================================
/*
# Create venues table for Pulse nightlife app

## Overview
Creates the `venues` table to store Kampala nightlife venues. This is a single-tenant
app with no authentication — all data is intentionally public/shared.

## New Tables
- `venues`
  - `id` (uuid, primary key, auto-generated)
  - `name` (text, not null) — venue display name
  - `location` (text, not null) — neighborhood/area description
  - `status` (text, not null, default 'quiet') — current live status: 'live', 'busy', 'quiet'
  - `image_url` (text) — optional URL to venue photo
  - `created_at` (timestamptz, default now()) — when the venue was added

## Seed Data
Inserts 8 default Kampala venues:
- Nomad (Gaba Road), Paradigm (Gaba Road), Thrones (Bugolobi), Catwalk (Kololo),
  Vanquish (Kololo), Governor (Industrial Area), Black Panther (Kampala), Taboo (Kololo)

## Security
- Enables RLS on `venues`.
- Adds 4 policies (SELECT, INSERT, UPDATE, DELETE) for anon + authenticated roles
  since the data is intentionally public and there is no sign-in flow.
*/

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL,
  status text NOT NULL DEFAULT 'quiet',
  image_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_venues" ON venues;
CREATE POLICY "anon_select_venues"
ON venues FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_venues" ON venues;
CREATE POLICY "anon_insert_venues"
ON venues FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_venues" ON venues;
CREATE POLICY "anon_update_venues"
ON venues FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_venues" ON venues;
CREATE POLICY "anon_delete_venues"
ON venues FOR DELETE
TO anon, authenticated USING (true);

-- Seed default Kampala venues (only if table is empty)
INSERT INTO venues (name, location, status, image_url)
SELECT * FROM (VALUES
  ('Nomad', 'Gaba Road', 'live', NULL),
  ('Paradigm', 'Gaba Road', 'busy', NULL),
  ('Thrones', 'Bugolobi', 'quiet', NULL),
  ('Catwalk', 'Kololo', 'live', NULL),
  ('Vanquish', 'Kololo', 'quiet', NULL),
  ('Governor', 'Industrial Area', 'busy', NULL),
  ('Black Panther', 'Kampala', 'quiet', NULL),
  ('Taboo', 'Bugolobi', 'live', NULL)
) AS v(name, location, status, image_url)
WHERE NOT EXISTS (SELECT 1 FROM venues LIMIT 1);

-- ============================================================================
-- >>> 20261002200435_create_posts_table.sql
-- ============================================================================
/*
# Create posts table for community feed

## Overview
Creates the `posts` table to store real user community updates about Kampala nightlife venues.
This is a single-tenant app with no authentication — all data is intentionally public/shared.

## New Tables
- `posts`
  - `id` (uuid, primary key, auto-generated)
  - `user_name` (text, not null) — display name of the poster
  - `venue_id` (uuid, nullable, references venues) — optional link to a venue
  - `venue_name` (text, nullable) — denormalized venue name for convenience
  - `content` (text, not null) — the post message
  - `likes` (integer, not null, default 0) — like count
  - `comments` (integer, not null, default 0) — comment count
  - `created_at` (timestamptz, default now()) — when the post was created

## Security
- Enables RLS on `posts`.
- Adds 4 policies (SELECT, INSERT, UPDATE, DELETE) for anon + authenticated roles
  since the data is intentionally public and there is no sign-in flow.
*/

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  venue_name text,
  content text NOT NULL,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_posts" ON posts;
CREATE POLICY "anon_select_posts"
ON posts FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_posts" ON posts;
CREATE POLICY "anon_insert_posts"
ON posts FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_posts" ON posts;
CREATE POLICY "anon_update_posts"
ON posts FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_posts" ON posts;
CREATE POLICY "anon_delete_posts"
ON posts FOR DELETE
TO anon, authenticated USING (true);

-- ============================================================================
-- >>> 20261003120000_enable_realtime_venues.sql
-- ============================================================================
/*
# Enable realtime on venues

Adds `venues` to the `supabase_realtime` publication so the app's
postgres_changes subscription receives inserts, updates and deletes.
Safe to re-run.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'venues'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venues;
  END IF;
END $$;

-- ============================================================================
-- >>> 20261003125900_reconcile_live_schema.sql
-- ============================================================================
/*
# Pulse backend 0 — adopt a database created by an earlier build

Idempotent. Runs right after the first three migrations (it sorts before `20261003130000_fix_venue_locations.sql`).
On a database created only by these migrations it changes nothing that the later migrations would not redo.

Earlier builds of Pulse created many of the same tables with different columns. Every migration here uses
`CREATE TABLE IF NOT EXISTS`, so those tables were kept as they were and later statements failed or, worse,
succeeded while the app's writes started failing. This brings them to the shape the migrations expect:

- views the migrations own are dropped first and recreated by them (old column layouts cannot be replaced)
- old NOT NULL columns the app never fills are relaxed (profiles.username blocked every sign-up)
- missing columns are added and backfilled (posts.user_name/venue_name/likes/comments, verification_requests.kind ...)
- wrong defaults are fixed (posts.status 'published' violated the status check; posts.media_type 'image'
  broke the media consistency check for text posts)
- duplicate rows are removed where the migrations need a unique key
- leftover permissive policies (e.g. "Allow all operations on notifications", "Allow profile modifications")
  are dropped; the migrations' own policies replace them
- old-style verification requests (type venue/performer, venue_ids[]) become one row per venue with kind/message

Nothing here deletes user content except exact duplicates (same user + same thing twice).
*/

-- views owned by the migrations ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_report_queue, public.venues_public, public.events_feed, public.venue_stats,
  public.profile_stats, public.post_reaction_counts, public.venue_vibe_counts;

-- helper: does a column exist ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.has_col(t text, c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = c)
$$;

-- old NOT NULL columns nothing writes any more -------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('profiles', 'username'), ('events', 'start_time'), ('promoters', 'brand_name'),
                                 ('promoters', 'user_id'), ('verification_requests', 'type')) v(t, c) LOOP
    IF pg_temp.has_col(r.t, r.c) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    END IF;
  END LOOP;
END $$;

-- posts ----------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.posts') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS venue_name text,
    ADD COLUMN IF NOT EXISTS likes integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS comments integer NOT NULL DEFAULT 0;
  -- (on a fresh database these columns arrive later, in migrations 2 and 4)
  IF pg_temp.has_col('posts', 'status') THEN
    ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'visible';
    UPDATE public.posts SET status = 'visible' WHERE status IS NULL OR status NOT IN ('visible', 'removed');
    ALTER TABLE public.posts ALTER COLUMN status SET NOT NULL;
  END IF;
  IF pg_temp.has_col('posts', 'media_type') AND pg_temp.has_col('posts', 'media_url') THEN
    ALTER TABLE public.posts ALTER COLUMN media_type DROP DEFAULT;
    UPDATE public.posts SET media_type = NULL WHERE media_url IS NULL AND media_type IS NOT NULL;
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL AND pg_temp.has_col('profiles', 'display_name') AND pg_temp.has_col('posts', 'user_id') THEN
    IF pg_temp.has_col('profiles', 'username') THEN
      UPDATE public.posts p SET user_name = coalesce(nullif(pr.display_name, ''), pr.username, '')
      FROM public.profiles pr WHERE pr.id = p.user_id AND p.user_name = '';
    ELSE
      UPDATE public.posts p SET user_name = coalesce(pr.display_name, '') FROM public.profiles pr WHERE pr.id = p.user_id AND p.user_name = '';
    END IF;
  END IF;
  IF pg_temp.has_col('posts', 'venue_id') THEN
    UPDATE public.posts p SET venue_name = v.name FROM public.venues v WHERE v.id = p.venue_id AND p.venue_name IS NULL;
  END IF;
  IF to_regclass('public.reactions') IS NOT NULL AND pg_temp.has_col('reactions', 'post_id') THEN
    UPDATE public.posts p SET likes = (SELECT count(*) FROM public.reactions r WHERE r.post_id = p.id);
  END IF;
  IF to_regclass('public.comments') IS NOT NULL AND pg_temp.has_col('comments', 'status') THEN
    UPDATE public.posts p SET comments = (SELECT count(*) FROM public.comments c WHERE c.post_id = p.id AND coalesce(c.status, 'visible') = 'visible');
  END IF;
END $$;

-- profiles: names for accounts made by the old sign-up -------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR NOT pg_temp.has_col('profiles', 'username') THEN RETURN; END IF;
  -- the app's checks need 3-30 characters; fall back to the generated pulse_xxxxxxxx handle style
  UPDATE public.profiles SET display_name = CASE
      WHEN char_length(btrim(coalesce(username, ''))) BETWEEN 3 AND 30
           AND NOT EXISTS (SELECT 1 FROM public.profiles o WHERE lower(o.display_name) = lower(btrim(profiles.username)))
        THEN btrim(username)
      ELSE 'pulse_' || left(replace(id::text, '-', ''), 8) END
  WHERE display_name IS NULL OR btrim(display_name) = '';
END $$;

-- events: old start/end columns ----------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  IF pg_temp.has_col('events', 'start_time') THEN
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS starts_at timestamptz;
    UPDATE public.events SET starts_at = start_time WHERE starts_at IS NULL;
  END IF;
  IF pg_temp.has_col('events', 'end_time') THEN
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS ends_at timestamptz;
    UPDATE public.events SET ends_at = end_time WHERE ends_at IS NULL AND end_time > starts_at;
  END IF;
END $$;

-- small missing columns --------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.promoters') IS NOT NULL THEN
    ALTER TABLE public.promoters ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS avatar_url text;
    IF pg_temp.has_col('promoters', 'brand_name') THEN UPDATE public.promoters SET name = brand_name WHERE name IS NULL; END IF;
    UPDATE public.promoters SET name = 'Promoter' WHERE name IS NULL;
    ALTER TABLE public.promoters ALTER COLUMN name SET NOT NULL;
  END IF;
  IF to_regclass('public.artists_djs') IS NOT NULL THEN ALTER TABLE public.artists_djs ADD COLUMN IF NOT EXISTS avatar_url text; END IF;
  IF to_regclass('public.venue_managers') IS NOT NULL THEN
    ALTER TABLE public.venue_managers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    UPDATE public.venue_managers SET role = 'manager' WHERE role IS NULL OR role NOT IN ('owner', 'manager');
  END IF;
END $$;

-- verification_requests: type/details/venue_ids -> kind/message, one venue per row ----------------------
DO $$
BEGIN
  IF to_regclass('public.verification_requests') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.verification_requests
    ADD COLUMN IF NOT EXISTS kind text,
    ADD COLUMN IF NOT EXISTS message text,
    ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS note text;
  ALTER TABLE public.verification_requests DROP CONSTRAINT IF EXISTS verification_requests_check;
  ALTER TABLE public.verification_requests DROP CONSTRAINT IF EXISTS verification_requests_type_check;
  IF pg_temp.has_col('verification_requests', 'type') THEN
    UPDATE public.verification_requests SET kind = CASE WHEN type = 'venue' THEN 'venue' ELSE 'host' END WHERE kind IS NULL;
  END IF;
  UPDATE public.verification_requests SET kind = CASE WHEN venue_id IS NOT NULL THEN 'venue' ELSE 'host' END WHERE kind IS NULL;
  IF pg_temp.has_col('verification_requests', 'details') THEN
    UPDATE public.verification_requests SET message = left(details, 1000) WHERE message IS NULL AND details IS NOT NULL;
  END IF;
  IF pg_temp.has_col('verification_requests', 'venue_ids') THEN
    -- one row per venue: the first venue stays on the original row, the others get copies
    INSERT INTO public.verification_requests (user_id, type, kind, role, venue_id, status, message, created_at)
    SELECT r.user_id, r.type, 'venue', NULL, u.vid, r.status, r.message, r.created_at
    FROM public.verification_requests r
    CROSS JOIN LATERAL unnest(r.venue_ids[2:]) AS u(vid)
    WHERE r.kind = 'venue' AND r.venue_id IS NULL AND cardinality(r.venue_ids) > 1;
    UPDATE public.verification_requests SET venue_id = venue_ids[1] WHERE kind = 'venue' AND venue_id IS NULL AND cardinality(venue_ids) >= 1;
    UPDATE public.verification_requests SET venue_ids = ARRAY[venue_id] WHERE kind = 'venue' AND venue_id IS NOT NULL AND cardinality(venue_ids) > 1;
  END IF;
  -- a venue request must name a venue; one that names none cannot be reviewed
  UPDATE public.verification_requests SET status = 'rejected', note = coalesce(note, 'No venue selected')
  WHERE kind = 'venue' AND venue_id IS NULL AND coalesce(status, 'pending') = 'pending';
  UPDATE public.verification_requests SET kind = 'host' WHERE kind = 'venue' AND venue_id IS NULL;
  UPDATE public.verification_requests SET role = NULL WHERE kind = 'venue';
  UPDATE public.verification_requests SET status = 'pending' WHERE status IS NULL;
  ALTER TABLE public.verification_requests ALTER COLUMN status SET NOT NULL, ALTER COLUMN status SET DEFAULT 'pending';
  ALTER TABLE public.verification_requests ALTER COLUMN kind SET NOT NULL;
  ALTER TABLE public.verification_requests ALTER COLUMN user_id SET DEFAULT auth.uid();
  -- one pending request per (user, kind, venue): keep the newest
  DELETE FROM public.verification_requests a USING public.verification_requests b
  WHERE a.status = 'pending' AND b.status = 'pending' AND a.user_id = b.user_id AND a.kind = b.kind
    AND coalesce(a.venue_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.venue_id, '00000000-0000-0000-0000-000000000000')
    AND (a.created_at, a.id) < (b.created_at, b.id);
END $$;

-- unique keys the migrations rely on (ON CONFLICT, one review per venue) --------------------------------
DO $$
BEGIN
  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    DELETE FROM public.notification_reads WHERE user_id IS NULL OR notification_id IS NULL;
    DELETE FROM public.notification_reads a USING public.notification_reads b
    WHERE a.user_id = b.user_id AND a.notification_id = b.notification_id AND a.ctid < b.ctid;
    ALTER TABLE public.notification_reads ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN notification_id SET NOT NULL,
      ALTER COLUMN user_id SET DEFAULT auth.uid();
    CREATE UNIQUE INDEX IF NOT EXISTS notification_reads_user_notification_uq ON public.notification_reads (user_id, notification_id);
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL AND pg_temp.has_col('reviews', 'venue_id') THEN
    DELETE FROM public.reviews a USING public.reviews b
    WHERE a.venue_id = b.venue_id AND a.user_id = b.user_id AND (a.created_at, a.id) < (b.created_at, b.id);
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_venue_user_uq ON public.reviews (venue_id, user_id);
    ALTER TABLE public.reviews ALTER COLUMN user_id SET DEFAULT auth.uid();
  END IF;
  IF to_regclass('public.saved_venues') IS NOT NULL AND pg_temp.has_col('saved_venues', 'device_id') THEN
    DELETE FROM public.saved_venues a USING public.saved_venues b
    WHERE a.device_id = b.device_id AND a.venue_id = b.venue_id AND a.ctid < b.ctid;
  END IF;
END $$;

-- foreign keys that make deletes cascade (NOT VALID: old orphans are left alone, new rows are checked) ----
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('events', 'venue_id', 'venues', 'CASCADE'), ('posts', 'venue_id', 'venues', 'SET NULL'),
      ('reviews', 'venue_id', 'venues', 'CASCADE'), ('saved_venues', 'venue_id', 'venues', 'CASCADE'),
      ('venue_follows', 'venue_id', 'venues', 'CASCADE'), ('venue_managers', 'venue_id', 'venues', 'CASCADE'),
      ('notifications', 'post_id', 'posts', 'CASCADE'), ('notifications', 'venue_id', 'venues', 'SET NULL'),
      ('notification_reads', 'notification_id', 'notifications', 'CASCADE')) v(t, c, ref, act) LOOP
    CONTINUE WHEN to_regclass('public.' || r.t) IS NULL OR NOT pg_temp.has_col(r.t, r.c);
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
      WHERE k.conrelid = ('public.' || r.t)::regclass AND k.contype = 'f' AND a.attname = r.c);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s NOT VALID',
                   r.t, r.t || '_' || r.c || '_fkey', r.c, r.ref, r.act);
  END LOOP;
END $$;

-- leftover permissive policies -------------------------------------------------------------------------
-- Policies are OR-ed: one "USING (true)" policy defeats every owner check on the table. The migrations
-- (re)create the policies the app needs; anything else on these tables goes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('event_categories', 'Allow public read access on event_categories'),
      ('events', 'Allow public read access on events'), ('events', 'Events are viewable by everyone.'),
      ('notifications', 'Allow all operations on notifications'), ('notifications', 'Allow public insert on notifications'),
      ('notifications', 'Allow public select on notifications'),
      ('posts', 'Authenticated users can create posts.'), ('posts', 'Posts are viewable by everyone.'),
      ('profiles', 'Allow insert/update for users on profiles'), ('profiles', 'Allow profile modifications'),
      ('profiles', 'Allow public read access on profiles'), ('profiles', 'Allow public read profiles'),
      ('profiles', 'Allow users to insert their own profile'), ('profiles', 'Allow users to read all profiles'),
      ('profiles', 'Allow users to update their own profile'), ('profiles', 'Public profiles are viewable by everyone.'),
      ('profiles', 'Users can insert their own profile.'), ('profiles', 'Users can update their own profile.'),
      ('reaction_types', 'Public read reaction_types'),
      ('reactions', 'Auth manage reactions'), ('reactions', 'Authenticated users insert reactions'),
      ('reactions', 'Public reactions read'), ('reactions', 'Public read reactions'),
      ('saved_venues', 'Allow all on saved_venues'),
      ('venue_reactions', 'Auth manage venue_reactions'), ('venue_reactions', 'Public read venue_reactions'),
      ('verification_requests', 'Users can create verification requests'),
      ('verification_requests', 'Users can view their own requests')) v(t, name) LOOP
    IF to_regclass('public.' || r.t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.name, r.t);
    END IF;
  END LOOP;
END $$;

-- row level security that was switched off --------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.user_preferences') IS NOT NULL THEN ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- checks the migrations declare inside CREATE TABLE (so they were never added to pre-existing tables) ----------
-- NOT VALID: existing rows are not re-checked here, but every new or updated row is.
DO $$
DECLARE r record;
BEGIN
  -- a profile name that would fail the name rule (e.g. an email address, which must never be public) is replaced
  -- by the generated handle first, otherwise any later update of that profile would be rejected
  IF to_regclass('public.profiles') IS NOT NULL AND pg_temp.has_col('profiles', 'display_name') THEN
    UPDATE public.profiles SET display_name = 'pulse_' || left(replace(id::text, '-', ''), 8)
    WHERE display_name IS NULL OR NOT (char_length(btrim(display_name)) BETWEEN 3 AND 30) OR display_name LIKE '%@%'
       OR lower(display_name) IN ('admin', 'administrator', 'pulse', 'pulse admin', 'pulse team', 'official', 'support', 'moderator');
    ALTER TABLE public.profiles ALTER COLUMN display_name SET NOT NULL;
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('events', 'events_cover_charge_ugx_check', 'CHECK (cover_charge_ugx IS NULL OR cover_charge_ugx >= 0)'),
      ('events', 'events_description_check', 'CHECK (description IS NULL OR char_length(description) <= 4000)'),
      ('events', 'events_status_check', $c$CHECK (status IN ('draft', 'published', 'cancelled'))$c$),
      ('events', 'events_time_ck', 'CHECK (ends_at IS NULL OR ends_at > starts_at)'),
      ('events', 'events_title_check', 'CHECK (char_length(btrim(title)) BETWEEN 2 AND 120)'),
      ('profiles', 'profiles_account_type_ck', $c$CHECK (account_type IN ('user', 'host', 'venue'))$c$),
      ('profiles', 'profiles_avatar_https_ck', $c$CHECK (avatar_url IS NULL OR avatar_url ~ '^https://')$c$),
      ('profiles', 'profiles_bio_len_ck', 'CHECK (bio IS NULL OR char_length(bio) <= 280)'),
      ('profiles', 'profiles_display_name_ck', $c$CHECK (char_length(btrim(display_name)) BETWEEN 3 AND 30 AND display_name NOT LIKE '%@%'
         AND lower(display_name) <> ALL (ARRAY['admin', 'administrator', 'pulse', 'pulse admin', 'pulse team', 'official', 'support', 'moderator']))$c$),
      ('profiles', 'profiles_status_ck', $c$CHECK (status IN ('active', 'suspended', 'banned'))$c$),
      ('reaction_types', 'reaction_types_emoji_check', 'CHECK (char_length(emoji) BETWEEN 1 AND 16)'),
      ('reaction_types', 'reaction_types_kind_check', $c$CHECK (kind ~ '^[a-z][a-z0-9_]{1,23}$')$c$),
      ('saved_venues', 'saved_venues_device_id_check', 'CHECK (char_length(device_id) BETWEEN 8 AND 64)'),
      ('venue_managers', 'venue_managers_role_check', $c$CHECK (role IN ('owner', 'manager'))$c$),
      ('verification_requests', 'verification_requests_kind_check', $c$CHECK (kind IN ('host', 'venue'))$c$),
      ('verification_requests', 'verification_requests_message_check', 'CHECK (message IS NULL OR char_length(message) <= 1000)'),
      ('verification_requests', 'verification_venue_ck', $c$CHECK (kind <> 'venue' OR venue_id IS NOT NULL)$c$)) v(t, name, def) LOOP
    CONTINUE WHEN to_regclass('public.' || r.t) IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || r.t)::regclass AND conname = r.name);
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID', r.t, r.name, r.def);
    EXCEPTION WHEN undefined_column THEN NULL; -- that table's shape predates the column; the migration adds both later
    END;
  END LOOP;
  IF to_regclass('public.saved_venues') IS NOT NULL AND pg_temp.has_col('saved_venues', 'device_id') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS saved_venues_device_venue_uq ON public.saved_venues (device_id, venue_id);
  END IF;
END $$;

-- ============================================================================
-- >>> 20261003130000_fix_venue_locations.sql
-- ============================================================================
/*
# Normalize the 8 confirmed Pulse venues

## Why
The original seed migration's header comment listed Taboo under Kololo and
"Governor" instead of "Guvnor". Databases seeded from earlier versions (or
edited by hand) can therefore disagree with the confirmed venue list. The
frontend renders `venues.location` verbatim, so the database is the single
source of truth for neighborhood tags.

## What this does (idempotent, safe to re-run)
For each confirmed venue, matched case-insensitively on name:
- updates name + location to the confirmed values (renames Governor -> Guvnor,
  Gaba Road -> Ggaba Road, Taboo -> Bugolobi)
- inserts the venue (status 'quiet') if it does not exist yet
Also updates the denormalized `posts.venue_name` for the Governor -> Guvnor rename.

## Confirmed list
Thrones - Bugolobi | Taboo - Bugolobi | Guvnor - Industrial Area
Black Panther - Kampala | Nomad - Ggaba Road | Paradigm - Ggaba Road
Catwalk - Kololo | Vanquish - Kololo
*/

DO $$
DECLARE
  r record;
BEGIN
  -- Keep denormalized post venue names in sync with the Governor -> Guvnor rename
  UPDATE posts SET venue_name = 'Guvnor'
  WHERE lower(btrim(venue_name)) = 'governor';

  FOR r IN
    SELECT * FROM (VALUES
      ('Thrones',       'Bugolobi'),
      ('Taboo',         'Bugolobi'),
      ('Guvnor',        'Industrial Area'),
      ('Black Panther', 'Kampala'),
      ('Nomad',         'Ggaba Road'),
      ('Paradigm',      'Ggaba Road'),
      ('Catwalk',       'Kololo'),
      ('Vanquish',      'Kololo')
    ) AS c(name, location)
  LOOP
    UPDATE venues
    SET name = r.name, location = r.location
    WHERE lower(btrim(name)) IN (lower(r.name), CASE WHEN r.name = 'Guvnor' THEN 'governor' ELSE lower(r.name) END)
      AND (name IS DISTINCT FROM r.name OR location IS DISTINCT FROM r.location);

    IF NOT EXISTS (
      SELECT 1 FROM venues
      WHERE lower(btrim(name)) = lower(r.name)
    ) THEN
      INSERT INTO venues (name, location, status) VALUES (r.name, r.location, 'quiet');
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- >>> 20261003131000_profile_saved_venues_notifications.sql
-- ============================================================================
/*
# Profile tab: saved venues + notifications

## New Tables
- `saved_venues` — bookmarks. The app has no sign-in flow yet, so rows are keyed
  by an anonymous per-device id (`device_id`, generated client-side) instead of a
  user id. Swap `device_id` for `auth.uid()` when real auth lands.
  - unique (device_id, venue_id); cascades when a venue is deleted
- `notifications` — broadcast alerts shown in Profile > Notifications.
  Read/unread state is kept per device in the browser, not in this table.
  - `type`: 'venue_live' | 'community' | 'system'

## Automation
- Trigger `venues_notify_live`: when a venue's status changes to 'live', a
  'venue_live' notification is inserted automatically.

## Security
- RLS enabled on both tables.
- saved_venues: anon + authenticated may SELECT / INSERT / DELETE
  (same "intentionally public, no auth yet" model as venues and posts).
- notifications: anon + authenticated may SELECT only. Rows are created by the
  trigger above or from the Supabase dashboard / service role.

## Realtime
- `notifications` is added to the supabase_realtime publication so new alerts
  appear without a reload.
*/

-- saved_venues -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 64),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, venue_id)
);

CREATE INDEX IF NOT EXISTS saved_venues_device_idx ON saved_venues (device_id);

ALTER TABLE saved_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_saved_venues" ON saved_venues;
CREATE POLICY "anon_select_saved_venues"
ON saved_venues FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_saved_venues" ON saved_venues;
CREATE POLICY "anon_insert_saved_venues"
ON saved_venues FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_saved_venues" ON saved_venues;
CREATE POLICY "anon_delete_saved_venues"
ON saved_venues FOR DELETE
TO anon, authenticated USING (true);

-- notifications ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'system' CHECK (type IN ('venue_live', 'community', 'system')),
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications"
ON notifications FOR SELECT
TO anon, authenticated USING (true);

-- Seed a few starter notifications (only if the table is empty)
INSERT INTO notifications (title, body, type, created_at)
SELECT * FROM (VALUES
  ('Welcome to Pulse', 'Real-time nightlife across Kampala. Check Tonight to see what is live right now.', 'system', now() - interval '3 hours'),
  ('Save your favourite spots', 'Tap the bookmark on any venue to keep it in Profile > Saved venues.', 'system', now() - interval '2 hours'),
  ('See what Kampala is saying', 'The Community tab is where people post live updates from venues.', 'community', now() - interval '1 hour')
) AS n(title, body, type, created_at)
WHERE NOT EXISTS (SELECT 1 FROM notifications LIMIT 1);

-- Auto-alert when a venue goes live -------------------------------------------
CREATE OR REPLACE FUNCTION notify_venue_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN
    INSERT INTO notifications (title, body, type, venue_id)
    VALUES (
      NEW.name || ' is live now',
      'Things are picking up in ' || NEW.location || '. Head over!',
      'venue_live',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS venues_notify_live ON venues;
CREATE TRIGGER venues_notify_live
AFTER UPDATE OF status ON venues
FOR EACH ROW EXECUTE FUNCTION notify_venue_live();

-- Realtime ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ============================================================================
-- >>> 20261011100000_backend_identity_and_venues.sql
-- ============================================================================
/*
# Pulse backend 1/3 — identity, roles, venues, events

Safe to apply on top of the existing schema; it only ADDS (plus one status
vocabulary change, see below). Idempotent.

## Identity & privacy (Facebook-style)
- `profiles`: one row per auth user, created by a trigger on signup. Holds ONLY a
  public display name + avatar + bio. Email and real name never leave auth.users.
- `user_preferences`: per-user settings (theme + alert toggles).
- `admins`: PULSE Administrators. Add yourself from the SQL editor (see README).

## Account types
Regular User (`user`), Verified Host/MC/DJ (`host`), Venue Account (`venue`),
plus Administrator (row in `admins`). Users cannot change their own
account_type / is_verified / status: there is no UPDATE privilege on those
columns. They go through `verification_requests` -> `admin_review_verification`.

## Venues
- New columns (slug, description, address, coordinates, contact, is_verified, status expiry)
- Statuses are now: live | sold_out | not_active  ('busy' -> 'live', 'quiet' -> 'not_active').
  Live/Sold-out ALWAYS carry an expiry (default 6h). `venues_public` exposes the
  *effective* status (expired => not_active) and `expire_venue_statuses()` flips
  the stored value every minute when pg_cron is available.
- `venue_managers` links venue accounts to the venues they run.
- `set_venue_status()` is the only way a manager changes a status.

## Events
`event_categories`, `promoters`, `artists_djs`, `events`, `event_artists`;
`events_feed` view adds phase: upcoming | live_now | ended | cancelled.

## Also here
`verification_requests`, `moderation_log`, admin RPCs for venues and
verification, `delete_my_account()`.

NOTE: RLS on the legacy tables (venues, posts, saved_venues) is tightened in
migration 3/3, so the current frontend keeps working until you apply that.
*/

-- ============================================================================
-- Utilities
-- ============================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ============================================================================
-- Core identity tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_url text,
  bio text,
  account_type text NOT NULL DEFAULT 'user',
  is_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_account_type_ck CHECK (account_type IN ('user', 'host', 'venue')),
  CONSTRAINT profiles_status_ck CHECK (status IN ('active', 'suspended', 'banned')),
  CONSTRAINT profiles_bio_len_ck CHECK (bio IS NULL OR char_length(bio) <= 280),
  CONSTRAINT profiles_avatar_https_ck CHECK (avatar_url IS NULL OR avatar_url ~ '^https://'),
  CONSTRAINT profiles_display_name_ck CHECK (
    char_length(btrim(display_name)) BETWEEN 3 AND 30
    AND display_name NOT LIKE '%@%'
    AND lower(display_name) NOT IN ('admin','administrator','pulse','pulse admin','pulse team','official','support','moderator')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_uq ON public.profiles (lower(display_name));

DROP TRIGGER IF EXISTS profiles_touch ON public.profiles;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  live_venue_alerts boolean NOT NULL DEFAULT true,
  community_alerts boolean NOT NULL DEFAULT true,
  announcements boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS user_preferences_touch ON public.user_preferences;
CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- Helper predicates (SECURITY DEFINER so policies can call them safely)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active');
END $$;

CREATE OR REPLACE FUNCTION public.manages_venue(p_venue_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.is_admin()
      OR EXISTS (SELECT 1 FROM public.venue_managers m
                 WHERE m.venue_id = p_venue_id AND m.user_id = auth.uid());
END $$;

-- ============================================================================
-- Signup hook: create profile + preferences (never uses the email)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base text;
  candidate text;
  tries int := 0;
BEGIN
  base := nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'display_name', '')), '');
  IF base IS NULL
     OR base LIKE '%@%'
     OR char_length(base) NOT BETWEEN 3 AND 30
     OR lower(base) IN ('admin','administrator','pulse','pulse admin','pulse team','official','support','moderator')
  THEN
    base := 'pulse_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;

  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(display_name) = lower(candidate)) AND tries < 20 LOOP
    tries := tries + 1;
    candidate := left(base, 24) || '_' || (floor(random() * 9000) + 1000)::int;
  END LOOP;

  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, candidate);
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill users that signed up before this migration
INSERT INTO public.profiles (id, display_name)
SELECT u.id, 'pulse_' || substr(replace(u.id::text, '-', ''), 1, 8)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

INSERT INTO public.user_preferences (user_id)
SELECT u.id FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_preferences p WHERE p.user_id = u.id);

-- ============================================================================
-- Venues: new columns, status vocabulary, expiry
-- ============================================================================
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Status vocabulary: busy -> live, quiet/anything else -> not_active.
-- The old "venue went live" broadcast trigger is paused so this data migration
-- doesn't create spurious notifications.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'venues_notify_live' AND tgrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues DISABLE TRIGGER venues_notify_live;
  END IF;
END $$;

UPDATE public.venues SET status = 'live' WHERE status = 'busy';
UPDATE public.venues SET status = 'not_active' WHERE status NOT IN ('live', 'sold_out', 'not_active');
UPDATE public.venues
SET status_expires_at = now() + interval '6 hours', status_updated_at = coalesce(status_updated_at, now())
WHERE status IN ('live', 'sold_out') AND status_expires_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'venues_notify_live' AND tgrelid = 'public.venues'::regclass) THEN
    ALTER TABLE public.venues ENABLE TRIGGER venues_notify_live;
  END IF;
END $$;

ALTER TABLE public.venues ALTER COLUMN status SET DEFAULT 'not_active';
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_status_check;
ALTER TABLE public.venues ADD CONSTRAINT venues_status_check CHECK (status IN ('live', 'sold_out', 'not_active'));

-- Slugs for venue detail pages
WITH s AS (
  SELECT id,
         lower(btrim(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '-')) AS base,
         row_number() OVER (
           PARTITION BY lower(btrim(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '-'))
           ORDER BY created_at, id
         ) AS rn
  FROM public.venues WHERE slug IS NULL
)
UPDATE public.venues v
SET slug = CASE WHEN s.rn = 1 THEN s.base ELSE s.base || '-' || s.rn END
FROM s WHERE v.id = s.id;

CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_uq ON public.venues (slug) WHERE slug IS NOT NULL;

-- Keep expiry/timestamps consistent no matter who writes the row
CREATE OR REPLACE FUNCTION public.venues_status_defaults()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'not_active' THEN
    NEW.status_expires_at := NULL;
  ELSIF NEW.status_expires_at IS NULL THEN
    NEW.status_expires_at := now() + interval '6 hours';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS venues_status_defaults ON public.venues;
CREATE TRIGGER venues_status_defaults BEFORE INSERT OR UPDATE ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.venues_status_defaults();

-- ============================================================================
-- Venue accounts, verification, moderation log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.venue_managers (
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX IF NOT EXISTS venue_managers_user_idx ON public.venue_managers (user_id);

CREATE TABLE IF NOT EXISTS public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('host', 'venue')),
  venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE,
  message text CHECK (message IS NULL OR char_length(message) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_venue_ck CHECK (kind <> 'venue' OR venue_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_one_pending_uq
  ON public.verification_requests (user_id, kind, coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.moderation_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.log_admin_action(p_action text, p_target_type text, p_target_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.moderation_log (admin_id, action, target_type, target_id, note)
  VALUES (auth.uid(), p_action, p_target_type, p_target_id, p_note);
END $$;

-- ============================================================================
-- Directory + events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

INSERT INTO public.event_categories (name, slug) VALUES
  ('Club Night', 'club-night'), ('Live Music', 'live-music'), ('DJ Set', 'dj-set'),
  ('Ladies Night', 'ladies-night'), ('Karaoke', 'karaoke'), ('Festival', 'festival'),
  ('Pool Party', 'pool-party'), ('Comedy', 'comedy')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.promoters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bio text,
  avatar_url text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.artists_djs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_name text NOT NULL,
  bio text,
  avatar_url text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  promoter_id uuid REFERENCES public.promoters(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.event_categories(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  cover_image_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  cover_charge_ugx integer CHECK (cover_charge_ugx IS NULL OR cover_charge_ugx >= 0),
  ticket_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_time_ck CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS events_starts_idx ON public.events (starts_at);
CREATE INDEX IF NOT EXISTS events_venue_idx ON public.events (venue_id);

DROP TRIGGER IF EXISTS events_touch ON public.events;
CREATE TRIGGER events_touch BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_artists (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists_djs(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, artist_id)
);

-- ============================================================================
-- Views
-- ============================================================================
CREATE OR REPLACE VIEW public.venues_public WITH (security_invoker = true) AS
SELECT v.id, v.name, v.slug, v.location, v.address, v.description, v.image_url,
       v.latitude, v.longitude, v.phone, v.whatsapp, v.is_verified, v.created_at,
       CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
            THEN 'not_active' ELSE v.status END AS status,
       CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
            THEN NULL ELSE v.status_expires_at END AS status_expires_at,
       v.status_updated_at
FROM public.venues v;

CREATE OR REPLACE VIEW public.events_feed WITH (security_invoker = true) AS
SELECT e.*,
       CASE
         WHEN e.status = 'cancelled' THEN 'cancelled'
         WHEN now() < e.starts_at THEN 'upcoming'
         WHEN now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours') THEN 'live_now'
         ELSE 'ended'
       END AS phase
FROM public.events e;

-- ============================================================================
-- RPCs
-- ============================================================================
-- Managers/admins set a venue's status. Live/Sold out auto-expire.
CREATE OR REPLACE FUNCTION public.set_venue_status(p_venue_id uuid, p_status text, p_duration_minutes integer DEFAULT 360)
RETURNS public.venues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.venues;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF NOT public.manages_venue(p_venue_id) THEN RAISE EXCEPTION 'you do not manage this venue' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('live', 'sold_out', 'not_active') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  IF p_status <> 'not_active' AND (p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 15 AND 720) THEN
    RAISE EXCEPTION 'duration must be between 15 and 720 minutes' USING ERRCODE = '22023';
  END IF;

  UPDATE public.venues
  SET status = p_status,
      status_expires_at = CASE WHEN p_status = 'not_active' THEN NULL ELSE now() + make_interval(mins => p_duration_minutes) END,
      status_updated_by = auth.uid(),
      status_updated_at = now()
  WHERE id = p_venue_id
  RETURNING * INTO v;

  IF NOT FOUND THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $$;

-- Flip expired statuses in storage (the venues_public view already hides them).
CREATE OR REPLACE FUNCTION public.expire_venue_statuses()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.venues SET status = 'not_active', status_expires_at = NULL
  WHERE status IN ('live', 'sold_out') AND status_expires_at IS NOT NULL AND status_expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available (%). Enable it in Dashboard > Database > Extensions, then re-run this block.', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pulse-expire-venue-status';
    PERFORM cron.schedule('pulse-expire-venue-status', '* * * * *', 'SELECT public.expire_venue_statuses()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule venue status expiry: %', SQLERRM;
END $$;

-- Admin: create / edit venues
CREATE OR REPLACE FUNCTION public.admin_create_venue(p_name text, p_location text)
RETURNS public.venues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.venues;
  base text;
  candidate text;
  n int := 1;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  base := lower(btrim(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'), '-'));
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.venues WHERE slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  INSERT INTO public.venues (name, location, slug, status) VALUES (btrim(p_name), btrim(p_location), candidate, 'not_active')
  RETURNING * INTO v;
  PERFORM public.log_admin_action('create_venue', 'venue', v.id, v.name);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_venue(
  p_venue_id uuid, p_name text DEFAULT NULL, p_location text DEFAULT NULL, p_is_verified boolean DEFAULT NULL)
RETURNS public.venues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.venues;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.venues
  SET name = coalesce(btrim(p_name), name),
      location = coalesce(btrim(p_location), location),
      is_verified = coalesce(p_is_verified, is_verified)
  WHERE id = p_venue_id RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.log_admin_action('update_venue', 'venue', v.id,
    concat_ws(', ', 'name=' || v.name, 'location=' || v.location, 'verified=' || v.is_verified));
  RETURN v;
END $$;

-- Admin: approve / reject host or venue-account requests
CREATE OR REPLACE FUNCTION public.admin_review_verification(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS public.verification_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.verification_requests;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;

  SELECT * INTO r FROM public.verification_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already reviewed' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.verification_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(), reviewed_at = now(), note = p_note
  WHERE id = p_request_id RETURNING * INTO r;

  IF p_approve THEN
    UPDATE public.profiles SET account_type = r.kind, is_verified = true WHERE id = r.user_id;
    IF r.kind = 'venue' THEN
      INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (r.venue_id, r.user_id, 'owner')
      ON CONFLICT DO NOTHING;
      UPDATE public.venues SET is_verified = true WHERE id = r.venue_id;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (r.user_id, 'system',
          CASE WHEN p_approve THEN 'Verification approved' ELSE 'Verification not approved' END,
          CASE WHEN p_approve THEN 'Your ' || r.kind || ' account is now verified.'
               ELSE coalesce(nullif(p_note, ''), 'Your request was not approved this time.') END);

  PERFORM public.log_admin_action(CASE WHEN p_approve THEN 'approve_verification' ELSE 'reject_verification' END,
                                  'verification_request', r.id, p_note);
  RETURN r;
END $$;

-- Users can erase their account (cascades through all their content).
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  DELETE FROM auth.users WHERE id = auth.uid();
END $$;

-- ============================================================================
-- Row Level Security + grants (new tables)
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO anon, authenticated
  USING (status <> 'banned' OR id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT UPDATE (display_name, avatar_url, bio) ON public.profiles TO authenticated;

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_select_self ON public.admins;
CREATE POLICY admins_select_self ON public.admins FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.admins FROM anon, authenticated;
GRANT SELECT ON public.admins TO authenticated;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prefs_select_own ON public.user_preferences;
CREATE POLICY prefs_select_own ON public.user_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS prefs_insert_own ON public.user_preferences;
CREATE POLICY prefs_insert_own ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS prefs_update_own ON public.user_preferences;
CREATE POLICY prefs_update_own ON public.user_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.user_preferences FROM anon, authenticated;
GRANT SELECT ON public.user_preferences TO authenticated;
GRANT INSERT (user_id, theme, live_venue_alerts, community_alerts, announcements) ON public.user_preferences TO authenticated;
GRANT UPDATE (theme, live_venue_alerts, community_alerts, announcements) ON public.user_preferences TO authenticated;

ALTER TABLE public.venue_managers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vm_select ON public.venue_managers;
CREATE POLICY vm_select ON public.venue_managers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS vm_admin_write ON public.venue_managers;
CREATE POLICY vm_admin_write ON public.venue_managers FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.venue_managers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_managers TO authenticated;

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vr_select ON public.verification_requests;
CREATE POLICY vr_select ON public.verification_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS vr_insert ON public.verification_requests;
CREATE POLICY vr_insert ON public.verification_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND public.is_active_user());
REVOKE ALL ON public.verification_requests FROM anon, authenticated;
GRANT SELECT ON public.verification_requests TO authenticated;
GRANT INSERT (kind, venue_id, message) ON public.verification_requests TO authenticated;

ALTER TABLE public.moderation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS modlog_admin_select ON public.moderation_log;
CREATE POLICY modlog_admin_select ON public.moderation_log FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.moderation_log FROM anon, authenticated;
GRANT SELECT ON public.moderation_log TO authenticated;

-- Directory tables: public read, admin write
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_categories', 'promoters', 'artists_djs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t || '_admin_write', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events FOR SELECT TO anon, authenticated
  USING (status IN ('published', 'cancelled') OR public.manages_venue(venue_id));
DROP POLICY IF EXISTS events_insert ON public.events;
CREATE POLICY events_insert ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.manages_venue(venue_id) AND public.is_active_user());
DROP POLICY IF EXISTS events_update ON public.events;
CREATE POLICY events_update ON public.events FOR UPDATE TO authenticated
  USING (public.manages_venue(venue_id)) WITH CHECK (public.manages_venue(venue_id));
DROP POLICY IF EXISTS events_delete ON public.events;
CREATE POLICY events_delete ON public.events FOR DELETE TO authenticated USING (public.manages_venue(venue_id));
REVOKE ALL ON public.events FROM anon, authenticated;
GRANT SELECT ON public.events TO anon, authenticated;
GRANT INSERT (venue_id, promoter_id, category_id, title, description, cover_image_url, starts_at, ends_at,
              cover_charge_ugx, ticket_url, status) ON public.events TO authenticated;
GRANT UPDATE (promoter_id, category_id, title, description, cover_image_url, starts_at, ends_at,
              cover_charge_ugx, ticket_url, status) ON public.events TO authenticated;
GRANT DELETE ON public.events TO authenticated;

ALTER TABLE public.event_artists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_artists_select ON public.event_artists;
CREATE POLICY event_artists_select ON public.event_artists FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id));
DROP POLICY IF EXISTS event_artists_write ON public.event_artists;
CREATE POLICY event_artists_write ON public.event_artists FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND public.manages_venue(e.venue_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND public.manages_venue(e.venue_id)));
REVOKE ALL ON public.event_artists FROM anon, authenticated;
GRANT SELECT ON public.event_artists TO anon, authenticated;
GRANT INSERT, DELETE ON public.event_artists TO authenticated;

GRANT SELECT ON public.venues_public, public.events_feed TO anon, authenticated;

-- ============================================================================
-- Function privileges
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_venue_statuses() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_venue_status(uuid, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_venue(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_venue(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_review_verification(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_venue_status(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_venue(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_venue(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_verification(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_active_user(), public.manages_venue(uuid) TO anon, authenticated;

-- ============================================================================
-- >>> 20261011100500_reconcile_legacy_tables.sql
-- ============================================================================
/*
# Pulse backend 1b — bring pre-existing tables up to the shape migration 2 expects

Idempotent. Apply after migration 1 and before `20261011101000_backend_community.sql`.

Some projects already have `comments`, `reviews`, `reports`, `venue_follows` or `notification_reads` from an
earlier build, with different columns. Migration 2 creates those tables with `CREATE TABLE IF NOT EXISTS`, so it
skips them and then fails on missing columns (e.g. `column "target_type" does not exist`).

- `reports` without `target_type` cannot be mapped (no target to point at): it is renamed to `reports_legacy`
  (rows kept, locked to the service role) and migration 2 creates a fresh `reports`.
- The other tables keep their rows: missing columns are added (author names backfilled from `profiles`), stray
  NOT NULL columns the app never fills are relaxed, old CHECK constraints and policies are replaced by the ones
  migration 2 defines.

On a database that never had these tables this does nothing.
*/

-- reports: an old shape is set aside --------------------------------------------------------------
DO $$
DECLARE ix record;
BEGIN
  IF to_regclass('public.reports') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'target_type') THEN
    IF to_regclass('public.reports_legacy') IS NOT NULL THEN
      RAISE EXCEPTION 'public.reports has an old shape and public.reports_legacy already exists; rename or drop one of them first';
    END IF;
    ALTER TABLE public.reports RENAME TO reports_legacy;
    -- index names are schema-wide: free reports_pkey etc. for the new table
    FOR ix IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
              WHERE i.indrelid = 'public.reports_legacy'::regclass AND c.relname NOT LIKE '%\_legacy' LOOP
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', ix.relname, left(ix.relname, 56) || '_legacy');
    END LOOP;
    REVOKE ALL ON public.reports_legacy FROM anon, authenticated;
    ALTER TABLE public.reports_legacy ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'old public.reports renamed to public.reports_legacy';
  END IF;
END $$;

-- missing columns -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    ALTER TABLE public.comments
      ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'visible',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    ALTER TABLE public.reviews
      ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS body text,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'visible',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.venue_follows') IS NOT NULL THEN
    ALTER TABLE public.venue_follows ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    ALTER TABLE public.notification_reads ADD COLUMN IF NOT EXISTS read_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- comments/reviews text that lived under another column name ---------------------------------------
DO $$
DECLARE t text; src text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comments', 'reviews'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'body') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN body text', t);
    END IF;
    SELECT column_name INTO src FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t AND column_name IN ('content', 'comment', 'text', 'message')
    ORDER BY array_position(ARRAY['content', 'comment', 'text', 'message'], column_name::text) LIMIT 1;
    IF src IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET body = %I WHERE body IS NULL AND %I IS NOT NULL', t, src, src);
    END IF;
  END LOOP;
  -- a comment always has text
  IF to_regclass('public.comments') IS NOT NULL THEN
    UPDATE public.comments SET body = '(empty)' WHERE body IS NULL OR btrim(body) = '';
    ALTER TABLE public.comments ALTER COLUMN body SET NOT NULL;
  END IF;
END $$;

-- author names (later rows are stamped by migration 2's triggers) ----------------------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    UPDATE public.comments c SET user_name = p.display_name FROM public.profiles p WHERE p.id = c.user_id AND c.user_name = '';
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    UPDATE public.reviews r SET user_name = p.display_name FROM public.profiles p WHERE p.id = r.user_id AND r.user_name = '';
  END IF;
END $$;

-- stray NOT NULL columns, old CHECK constraints and old policies ------------------------------------
DO $$
DECLARE
  -- columns migration 2 (or later) defines; anything else NOT NULL without a default would break the app's inserts
  expected jsonb := '{
    "comments": ["id", "post_id", "user_id", "user_name", "body", "status", "created_at", "updated_at"],
    "reviews": ["id", "venue_id", "user_id", "user_name", "rating", "body", "status", "created_at", "updated_at"],
    "venue_follows": ["user_id", "venue_id", "created_at"],
    "notification_reads": ["user_id", "notification_id", "read_at"]
  }';
  t text; r record;
BEGIN
  FOR t IN SELECT jsonb_object_keys(expected) LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    FOR r IN SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = t AND is_nullable = 'NO' AND column_default IS NULL
               AND NOT (expected -> t) ? column_name LOOP
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', t, r.column_name);
    END LOOP;
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND contype = 'c' LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, r.conname);
    END LOOP;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- the CHECKs migration 2 would have created (NOT VALID: old rows are not re-checked) ---------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 500) NOT VALID;
    ALTER TABLE public.comments ADD CONSTRAINT comments_status_check CHECK (status IN ('visible', 'removed')) NOT VALID;
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5) NOT VALID;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_body_check CHECK (body IS NULL OR char_length(body) <= 1000) NOT VALID;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('visible', 'removed')) NOT VALID;
  END IF;
END $$;

-- ============================================================================
-- >>> 20261011101000_backend_community.sql
-- ============================================================================
/*
# Pulse backend 2/3 — community, moderation, notifications, storage

Idempotent. Adds comments, reactions, follows, reviews, RSVPs, reports, per-user
notifications with read state, moderation RPCs and Storage buckets.

## Rules enforced in the database (not the UI)
- Only active users can write. Suspended/banned users are blocked by RLS + triggers.
- Author names are copied from `profiles.display_name` by trigger, so a client can
  never post under another name (or a real name / email).
- Counters (posts.likes, posts.comments) are maintained by triggers only.
- Soft moderation: admins set content `status = 'removed'`; every action is logged
  in `moderation_log` and the author is notified.

## Notifications
- `notifications.user_id` NULL = broadcast to everyone; otherwise private to that user.
- Read state lives in `notification_reads` (works for broadcasts too).
- Fan-out respects `user_preferences` (live_venue_alerts / community_alerts / announcements).
- Triggers notify: venue followers when a venue goes live, post authors on new
  comments/reactions, users on new followers.

## Storage
Buckets `avatars` (2 MB) and `post-media` (5 MB), public read, users can write only
inside a folder named after their own user id: `<uid>/<file>`.
*/

-- ============================================================================
-- Posts: new columns (legacy rows keep working)
-- ============================================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_ck CHECK (status IN ('visible', 'removed'));
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_content_len_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_content_len_ck CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000) NOT VALID;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_https_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_https_ck CHECK (media_url IS NULL OR media_url ~ '^https://') NOT VALID;

CREATE INDEX IF NOT EXISTS posts_feed_idx ON public.posts (created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS posts_venue_idx ON public.posts (venue_id);
CREATE INDEX IF NOT EXISTS posts_user_idx ON public.posts (user_id);

-- ============================================================================
-- Community tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON public.comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user_idx ON public.comments (user_id);

CREATE TABLE IF NOT EXISTS public.reactions (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fire', 'heart', 'party')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.venue_follows (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);
CREATE INDEX IF NOT EXISTS venue_follows_venue_idx ON public.venue_follows (venue_id);

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS user_follows_followee_idx ON public.user_follows (followee_id);

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text CHECK (body IS NULL OR char_length(body) <= 1000),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('going', 'interested', 'saved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment', 'user', 'venue', 'event', 'review')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'violence', 'sexual', 'scam', 'misinformation', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_uq ON public.reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status, created_at);

-- ============================================================================
-- Notifications: per-user rows + read state
-- ============================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('venue_live', 'community', 'system', 'follow', 'reaction', 'comment', 'official_post', 'moderation', 'event'));
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- ============================================================================
-- Triggers: names, counters, notifications
-- ============================================================================
-- Internal helper: create a notification honouring the recipient's preferences.
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user uuid, p_type text, p_title text, p_body text DEFAULT '',
  p_actor uuid DEFAULT NULL, p_venue uuid DEFAULT NULL, p_post uuid DEFAULT NULL,
  p_event uuid DEFAULT NULL, p_pref text DEFAULT 'community_alerts')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE allowed boolean;
BEGIN
  IF p_user IS NULL OR p_user IS NOT DISTINCT FROM p_actor THEN RETURN; END IF;
  SELECT CASE p_pref
           WHEN 'always' THEN true
           WHEN 'live_venue_alerts' THEN up.live_venue_alerts
           WHEN 'announcements' THEN up.announcements
           ELSE up.community_alerts END
  INTO allowed FROM public.user_preferences up WHERE up.user_id = p_user;
  IF coalesce(allowed, true) THEN
    INSERT INTO public.notifications (user_id, type, title, body, actor_id, venue_id, post_id, event_id)
    VALUES (p_user, p_type, p_title, coalesce(p_body, ''), p_actor, p_venue, p_post, p_event);
  END IF;
END $$;

-- Rename propagation (denormalised author names stay correct)
CREATE OR REPLACE FUNCTION public.propagate_display_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    UPDATE public.posts SET user_name = NEW.display_name WHERE user_id = NEW.id;
    UPDATE public.comments SET user_name = NEW.display_name WHERE user_id = NEW.id;
    UPDATE public.reviews SET user_name = NEW.display_name WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_propagate_name ON public.profiles;
CREATE TRIGGER profiles_propagate_name AFTER UPDATE OF display_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.propagate_display_name();

-- Comments / reviews: stamp author, enforce active user + rate limit
CREATE OR REPLACE FUNCTION public.stamp_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  pname text;
  recent int;
BEGIN
  IF uid IS NULL THEN
    -- SQL editor / service role (seeding, maintenance) passes through untouched
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT display_name INTO pname FROM public.profiles WHERE id = uid AND status = 'active';
  IF pname IS NULL THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;

  IF TG_TABLE_NAME = 'comments' THEN
    SELECT count(*) INTO recent FROM public.comments WHERE user_id = uid AND created_at > now() - interval '10 minutes';
    IF recent >= 20 THEN RAISE EXCEPTION 'slow down: too many comments' USING ERRCODE = '54000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = NEW.post_id AND status = 'visible') THEN
      RAISE EXCEPTION 'post not available' USING ERRCODE = 'P0002';
    END IF;
    NEW.status := 'visible';
  END IF;

  NEW.user_id := uid;
  NEW.user_name := pname;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS comments_stamp ON public.comments;
CREATE TRIGGER comments_stamp BEFORE INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.stamp_author();
DROP TRIGGER IF EXISTS reviews_stamp ON public.reviews;
CREATE TRIGGER reviews_stamp BEFORE INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.stamp_author();

DROP TRIGGER IF EXISTS comments_touch ON public.comments;
CREATE TRIGGER comments_touch BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS reviews_touch ON public.reviews;
CREATE TRIGGER reviews_touch BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Counters
CREATE OR REPLACE FUNCTION public.sync_post_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  pid := coalesce(NEW.post_id, OLD.post_id);
  IF TG_TABLE_NAME = 'reactions' THEN
    UPDATE public.posts SET likes = (SELECT count(*) FROM public.reactions WHERE post_id = pid) WHERE id = pid;
  ELSE
    UPDATE public.posts SET comments = (SELECT count(*) FROM public.comments WHERE post_id = pid AND status = 'visible') WHERE id = pid;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS reactions_counter ON public.reactions;
CREATE TRIGGER reactions_counter AFTER INSERT OR UPDATE OR DELETE ON public.reactions
FOR EACH ROW EXECUTE FUNCTION public.sync_post_counters();
DROP TRIGGER IF EXISTS comments_counter ON public.comments;
CREATE TRIGGER comments_counter AFTER INSERT OR DELETE OR UPDATE OF status ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.sync_post_counters();

-- Notification triggers
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  SELECT user_id INTO author FROM public.posts WHERE id = NEW.post_id;
  PERFORM public.notify_user(author, 'comment', NEW.user_name || ' commented on your post',
                             left(NEW.body, 120), NEW.user_id, NULL, NEW.post_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS comments_notify ON public.comments;
CREATE TRIGGER comments_notify AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

CREATE OR REPLACE FUNCTION public.notify_on_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid; pname text;
BEGIN
  SELECT user_id INTO author FROM public.posts WHERE id = NEW.post_id;
  SELECT display_name INTO pname FROM public.profiles WHERE id = NEW.user_id;
  PERFORM public.notify_user(author, 'reaction',
    coalesce(pname, 'Someone') || ' reacted ' || CASE NEW.kind WHEN 'fire' THEN '🔥' WHEN 'heart' THEN '❤️' ELSE '🎉' END || ' to your post',
    '', NEW.user_id, NULL, NEW.post_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reactions_notify ON public.reactions;
CREATE TRIGGER reactions_notify AFTER INSERT ON public.reactions
FOR EACH ROW EXECUTE FUNCTION public.notify_on_reaction();

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pname text;
BEGIN
  SELECT display_name INTO pname FROM public.profiles WHERE id = NEW.follower_id;
  PERFORM public.notify_user(NEW.followee_id, 'follow', coalesce(pname, 'Someone') || ' started following you', '', NEW.follower_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_follows_notify ON public.user_follows;
CREATE TRIGGER user_follows_notify AFTER INSERT ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow();

-- Venue goes live -> notify followers (replaces the earlier broadcast version)
CREATE OR REPLACE FUNCTION public.notify_venue_live()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN
    INSERT INTO public.notifications (user_id, type, title, body, venue_id)
    SELECT f.user_id, 'venue_live', NEW.name || ' is live now',
           'Things are picking up in ' || NEW.location || '. Head over!', NEW.id
    FROM public.venue_follows f
    LEFT JOIN public.user_preferences up ON up.user_id = f.user_id
    WHERE f.venue_id = NEW.id AND coalesce(up.live_venue_alerts, true);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS venues_notify_live ON public.venues;
CREATE TRIGGER venues_notify_live AFTER UPDATE OF status ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.notify_venue_live();

-- ============================================================================
-- Views
-- ============================================================================
-- Aggregates only (runs with owner rights so counts are right while the
-- underlying follow rows stay private).
CREATE OR REPLACE VIEW public.venue_stats AS
SELECT v.id AS venue_id,
       (SELECT count(*) FROM public.venue_follows f WHERE f.venue_id = v.id) AS follower_count,
       (SELECT count(*) FROM public.reviews r WHERE r.venue_id = v.id AND r.status = 'visible') AS review_count,
       (SELECT round(avg(r.rating)::numeric, 2) FROM public.reviews r WHERE r.venue_id = v.id AND r.status = 'visible') AS avg_rating
FROM public.venues v;

CREATE OR REPLACE VIEW public.profile_stats AS
SELECT p.id AS user_id,
       (SELECT count(*) FROM public.user_follows f WHERE f.followee_id = p.id) AS follower_count,
       (SELECT count(*) FROM public.user_follows f WHERE f.follower_id = p.id) AS following_count,
       (SELECT count(*) FROM public.posts x WHERE x.user_id = p.id AND x.status = 'visible') AS post_count
FROM public.profiles p WHERE p.status <> 'banned';

CREATE OR REPLACE VIEW public.post_reaction_counts WITH (security_invoker = true) AS
SELECT post_id, kind, count(*)::int AS n FROM public.reactions GROUP BY post_id, kind;

-- Admin moderation queue (guarded by is_admin(); owner rights are needed to read
-- author names for any target).
CREATE OR REPLACE VIEW public.admin_report_queue AS
SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
       rp.display_name AS reporter_name,
       CASE r.target_type
         WHEN 'post' THEN (SELECT left(p.content, 200) FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT left(c.body, 200) FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT left(coalesce(v.body, ''), 200) FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'user' THEN (SELECT u.display_name FROM public.profiles u WHERE u.id = r.target_id)
         WHEN 'venue' THEN (SELECT x.name FROM public.venues x WHERE x.id = r.target_id)
         WHEN 'event' THEN (SELECT e.title FROM public.events e WHERE e.id = r.target_id)
       END AS target_preview,
       CASE r.target_type
         WHEN 'post' THEN (SELECT p.user_id FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT c.user_id FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT v.user_id FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'user' THEN r.target_id
       END AS target_user_id
FROM public.reports r
LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
WHERE public.is_admin();

-- ============================================================================
-- RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.unread_notification_count()
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int FROM public.notifications n
  WHERE (n.user_id IS NULL OR n.user_id = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.notification_reads r WHERE r.user_id = auth.uid() AND r.notification_id = n.id)
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE sql SET search_path = public AS $$
  INSERT INTO public.notification_reads (notification_id)
  SELECT n.id FROM public.notifications n
  WHERE (n.user_id IS NULL OR n.user_id = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.notification_reads r WHERE r.user_id = auth.uid() AND r.notification_id = n.id)
  ON CONFLICT DO NOTHING
$$;

-- Admin: suspend / ban / reinstate
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pr public.profiles;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('active', 'suspended', 'banned') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'you cannot change your own status' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'cannot moderate another administrator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET status = p_status WHERE id = p_user_id RETURNING * INTO pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002'; END IF;

  -- Banned accounts are also blocked at sign-in
  UPDATE auth.users SET banned_until = CASE WHEN p_status = 'banned' THEN now() + interval '100 years' ELSE NULL END
  WHERE id = p_user_id;

  PERFORM public.notify_user(p_user_id, 'moderation',
    CASE p_status WHEN 'active' THEN 'Your account was reinstated'
                  WHEN 'suspended' THEN 'Your account was suspended'
                  ELSE 'Your account was banned' END,
    coalesce(p_reason, ''), NULL, NULL, NULL, NULL, 'always');
  PERFORM public.log_admin_action('set_user_' || p_status, 'user', p_user_id, p_reason);
  RETURN pr;
END $$;

-- Admin: remove / restore content
CREATE OR REPLACE FUNCTION public.admin_set_content_status(p_type text, p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('visible', 'removed') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;

  IF p_type = 'post' THEN
    UPDATE public.posts SET status = p_status WHERE id = p_id RETURNING user_id INTO author;
  ELSIF p_type = 'comment' THEN
    UPDATE public.comments SET status = p_status WHERE id = p_id RETURNING user_id INTO author;
  ELSIF p_type = 'review' THEN
    UPDATE public.reviews SET status = p_status WHERE id = p_id RETURNING user_id INTO author;
  ELSE
    RAISE EXCEPTION 'unsupported content type' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'content not found' USING ERRCODE = 'P0002'; END IF;

  IF p_status = 'removed' THEN
    PERFORM public.notify_user(author, 'moderation', 'Your ' || p_type || ' was removed',
      coalesce(p_note, 'It broke the Pulse community guidelines.'), NULL, NULL, NULL, NULL, 'always');
  END IF;
  PERFORM public.log_admin_action(CASE WHEN p_status = 'removed' THEN 'remove_' ELSE 'restore_' END || p_type, p_type, p_id, p_note);
END $$;

-- Admin: close a report (optionally removing the reported content)
CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id uuid, p_action text, p_note text DEFAULT NULL, p_remove_content boolean DEFAULT false)
RETURNS public.reports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reports;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('actioned', 'dismissed') THEN RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023'; END IF;

  UPDATE public.reports SET status = p_action, handled_by = auth.uid(), handled_at = now(), note = p_note
  WHERE id = p_report_id AND status = 'open' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'report not found or already handled' USING ERRCODE = 'P0002'; END IF;

  IF p_action = 'actioned' AND p_remove_content AND r.target_type IN ('post', 'comment', 'review') THEN
    PERFORM public.admin_set_content_status(r.target_type, r.target_id, 'removed', p_note);
  END IF;
  PERFORM public.log_admin_action('resolve_report_' || p_action, 'report', r.id, p_note);
  RETURN r;
END $$;

-- ============================================================================
-- RLS + grants
-- ============================================================================
-- comments
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments FOR SELECT TO anon, authenticated
  USING (status = 'visible' OR user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS comments_update_own ON public.comments;
CREATE POLICY comments_update_own ON public.comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'visible' AND public.is_active_user())
  WITH CHECK (user_id = auth.uid() AND status = 'visible');
DROP POLICY IF EXISTS comments_delete_own ON public.comments;
CREATE POLICY comments_delete_own ON public.comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
REVOKE ALL ON public.comments FROM anon, authenticated;
GRANT SELECT ON public.comments TO anon, authenticated;
GRANT INSERT (post_id, body) ON public.comments TO authenticated;
GRANT UPDATE (body) ON public.comments TO authenticated;
GRANT DELETE ON public.comments TO authenticated;

-- reactions
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reactions_select ON public.reactions;
CREATE POLICY reactions_select ON public.reactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS reactions_insert ON public.reactions;
CREATE POLICY reactions_insert ON public.reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.status = 'visible'));
DROP POLICY IF EXISTS reactions_update_own ON public.reactions;
CREATE POLICY reactions_update_own ON public.reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_active_user()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS reactions_delete_own ON public.reactions;
CREATE POLICY reactions_delete_own ON public.reactions FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.reactions FROM anon, authenticated;
GRANT SELECT ON public.reactions TO anon, authenticated;
GRANT INSERT (post_id, kind) ON public.reactions TO authenticated;
GRANT UPDATE (kind) ON public.reactions TO authenticated;
GRANT DELETE ON public.reactions TO authenticated;

-- venue_follows
ALTER TABLE public.venue_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS venue_follows_select_own ON public.venue_follows;
CREATE POLICY venue_follows_select_own ON public.venue_follows FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS venue_follows_insert_own ON public.venue_follows;
CREATE POLICY venue_follows_insert_own ON public.venue_follows FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS venue_follows_delete_own ON public.venue_follows;
CREATE POLICY venue_follows_delete_own ON public.venue_follows FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.venue_follows FROM anon, authenticated;
GRANT SELECT, DELETE ON public.venue_follows TO authenticated;
GRANT INSERT (venue_id) ON public.venue_follows TO authenticated;

-- user_follows (you can see who you follow and who follows you)
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_follows_select ON public.user_follows;
CREATE POLICY user_follows_select ON public.user_follows FOR SELECT TO authenticated
  USING (follower_id = auth.uid() OR followee_id = auth.uid());
DROP POLICY IF EXISTS user_follows_insert_own ON public.user_follows;
CREATE POLICY user_follows_insert_own ON public.user_follows FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS user_follows_delete_own ON public.user_follows;
CREATE POLICY user_follows_delete_own ON public.user_follows FOR DELETE TO authenticated USING (follower_id = auth.uid());
REVOKE ALL ON public.user_follows FROM anon, authenticated;
GRANT SELECT, DELETE ON public.user_follows TO authenticated;
GRANT INSERT (followee_id) ON public.user_follows TO authenticated;

-- reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_select ON public.reviews;
CREATE POLICY reviews_select ON public.reviews FOR SELECT TO anon, authenticated
  USING (status = 'visible' OR user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS reviews_insert ON public.reviews;
CREATE POLICY reviews_insert ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS reviews_update_own ON public.reviews;
CREATE POLICY reviews_update_own ON public.reviews FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'visible' AND public.is_active_user())
  WITH CHECK (user_id = auth.uid() AND status = 'visible');
DROP POLICY IF EXISTS reviews_delete_own ON public.reviews;
CREATE POLICY reviews_delete_own ON public.reviews FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.reviews FROM anon, authenticated;
GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT (venue_id, rating, body) ON public.reviews TO authenticated;
GRANT UPDATE (rating, body) ON public.reviews TO authenticated;
GRANT DELETE ON public.reviews TO authenticated;

-- event_rsvps
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rsvps_select_own ON public.event_rsvps;
CREATE POLICY rsvps_select_own ON public.event_rsvps FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS rsvps_insert_own ON public.event_rsvps;
CREATE POLICY rsvps_insert_own ON public.event_rsvps FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.status = 'published'));
DROP POLICY IF EXISTS rsvps_delete_own ON public.event_rsvps;
CREATE POLICY rsvps_delete_own ON public.event_rsvps FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.event_rsvps FROM anon, authenticated;
GRANT SELECT, DELETE ON public.event_rsvps TO authenticated;
GRANT INSERT (event_id, kind) ON public.event_rsvps TO authenticated;

-- reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'open' AND public.is_active_user());
REVOKE ALL ON public.reports FROM anon, authenticated;
GRANT SELECT ON public.reports TO authenticated;
GRANT INSERT (target_type, target_id, reason, details) ON public.reports TO authenticated;

-- notifications: broadcast (user_id NULL) or your own. No client writes.
DROP POLICY IF EXISTS anon_select_notifications ON public.notifications;
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO anon, authenticated;

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nreads_select_own ON public.notification_reads;
CREATE POLICY nreads_select_own ON public.notification_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS nreads_insert_own ON public.notification_reads;
CREATE POLICY nreads_insert_own ON public.notification_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = notification_id));
DROP POLICY IF EXISTS nreads_delete_own ON public.notification_reads;
CREATE POLICY nreads_delete_own ON public.notification_reads FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.notification_reads FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notification_reads TO authenticated;
GRANT INSERT (notification_id) ON public.notification_reads TO authenticated;

GRANT SELECT ON public.venue_stats, public.profile_stats, public.post_reaction_counts TO anon, authenticated;
GRANT SELECT ON public.admin_report_queue TO authenticated;

-- Function privileges
REVOKE EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_content_status(text, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unread_notification_count() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_content_status(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unread_notification_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- ============================================================================
-- Storage buckets + policies (public read; write only inside your own folder)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('post-media', 'post-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
DECLARE b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['avatars', 'post-media'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'pulse_' || b || '_read');
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = %L)', 'pulse_' || b || '_read', b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'pulse_' || b || '_insert');
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_active_user())', 'pulse_' || b || '_insert', b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'pulse_' || b || '_update');
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1] = auth.uid()::text)', 'pulse_' || b || '_update', b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', 'pulse_' || b || '_delete');
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1] = auth.uid()::text)', 'pulse_' || b || '_delete', b);
  END LOOP;
END $$;

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['posts', 'comments', 'reactions', 'events', 'notifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- >>> 20261011110000_backend_lockdown.sql
-- ============================================================================
/*
# Pulse backend 3/3 — lock down the legacy open tables

!! APPLY THIS WHEN THE FRONTEND HAS SIGN-IN !!
Until now `venues`, `posts` and `saved_venues` had "anyone with the anon key can
read/write" policies (fine for the prototype, not for production). This migration:

- venues: public read. Clients can no longer insert/delete; managers may only
  edit descriptive fields on venues they manage; status changes go through
  `set_venue_status()`; admins use `admin_create_venue/admin_update_venue`.
- posts: public read of visible posts. Only signed-in, active users can post.
  Author name, official badge and counters are set by the database. Users can
  edit/delete only their own posts; admins can delete any.
- saved_venues: switches from anonymous device ids to the signed-in user
  (`user_id`). Old device-based rows are kept but become unreachable.

Official posts: `is_official` is true only when the author manages the venue AND
the venue is verified by an admin.

Idempotent.
*/

-- ============================================================================
-- venues
-- ============================================================================
DROP POLICY IF EXISTS anon_select_venues ON public.venues;
DROP POLICY IF EXISTS anon_insert_venues ON public.venues;
DROP POLICY IF EXISTS anon_update_venues ON public.venues;
DROP POLICY IF EXISTS anon_delete_venues ON public.venues;
DROP POLICY IF EXISTS venues_select ON public.venues;
DROP POLICY IF EXISTS venues_update_managers ON public.venues;

CREATE POLICY venues_select ON public.venues FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY venues_update_managers ON public.venues FOR UPDATE TO authenticated
  USING (public.manages_venue(id)) WITH CHECK (public.manages_venue(id));

REVOKE ALL ON public.venues FROM anon, authenticated;
GRANT SELECT ON public.venues TO anon, authenticated;
GRANT UPDATE (description, address, phone, whatsapp, image_url, latitude, longitude) ON public.venues TO authenticated;

-- ============================================================================
-- posts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.posts_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  pname text;
  recent int;
  v public.venues;
BEGIN
  IF uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000';
    END IF;
    RETURN NEW; -- SQL editor / service role (seeding)
  END IF;

  SELECT display_name INTO pname FROM public.profiles WHERE id = uid AND status = 'active';
  IF pname IS NULL THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;

  SELECT count(*) INTO recent FROM public.posts WHERE user_id = uid AND created_at > now() - interval '10 minutes';
  IF recent >= 10 THEN RAISE EXCEPTION 'slow down: too many posts' USING ERRCODE = '54000'; END IF;

  NEW.user_id := uid;
  NEW.user_name := pname;
  NEW.likes := 0;
  NEW.comments := 0;
  NEW.status := 'visible';
  NEW.is_official := false;
  NEW.venue_name := NULL;

  IF NEW.venue_id IS NOT NULL THEN
    SELECT * INTO v FROM public.venues WHERE id = NEW.venue_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;
    NEW.venue_name := v.name;
    NEW.is_official := v.is_verified AND EXISTS (
      SELECT 1 FROM public.venue_managers m WHERE m.venue_id = NEW.venue_id AND m.user_id = uid);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS posts_prepare ON public.posts;
CREATE TRIGGER posts_prepare BEFORE INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.posts_prepare();

DROP TRIGGER IF EXISTS posts_touch ON public.posts;
CREATE TRIGGER posts_touch BEFORE UPDATE OF content, media_url ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Official venue post -> notify that venue's followers
CREATE OR REPLACE FUNCTION public.notify_official_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, venue_id, post_id, actor_id)
  SELECT f.user_id, 'official_post', NEW.venue_name || ' posted an update', left(NEW.content, 120),
         NEW.venue_id, NEW.id, NEW.user_id
  FROM public.venue_follows f
  LEFT JOIN public.user_preferences up ON up.user_id = f.user_id
  WHERE f.venue_id = NEW.venue_id AND f.user_id <> NEW.user_id AND coalesce(up.community_alerts, true);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS posts_notify_official ON public.posts;
CREATE TRIGGER posts_notify_official AFTER INSERT ON public.posts
FOR EACH ROW WHEN (NEW.is_official) EXECUTE FUNCTION public.notify_official_post();

DROP POLICY IF EXISTS anon_select_posts ON public.posts;
DROP POLICY IF EXISTS anon_insert_posts ON public.posts;
DROP POLICY IF EXISTS anon_update_posts ON public.posts;
DROP POLICY IF EXISTS anon_delete_posts ON public.posts;
DROP POLICY IF EXISTS posts_select ON public.posts;
DROP POLICY IF EXISTS posts_insert ON public.posts;
DROP POLICY IF EXISTS posts_update_own ON public.posts;
DROP POLICY IF EXISTS posts_delete ON public.posts;

CREATE POLICY posts_select ON public.posts FOR SELECT TO anon, authenticated
  USING (status = 'visible' OR user_id = auth.uid() OR public.is_admin());
CREATE POLICY posts_insert ON public.posts FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY posts_update_own ON public.posts FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'visible' AND public.is_active_user())
  WITH CHECK (user_id = auth.uid() AND status = 'visible');
CREATE POLICY posts_delete ON public.posts FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL ON public.posts FROM anon, authenticated;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT (content, venue_id, event_id, media_url) ON public.posts TO authenticated;
GRANT UPDATE (content, media_url) ON public.posts TO authenticated;
GRANT DELETE ON public.posts TO authenticated;

-- ============================================================================
-- saved_venues: device id -> signed-in user
-- ============================================================================
ALTER TABLE public.saved_venues ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.saved_venues ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.saved_venues ALTER COLUMN user_id SET DEFAULT auth.uid();
CREATE UNIQUE INDEX IF NOT EXISTS saved_venues_user_venue_uq ON public.saved_venues (user_id, venue_id) WHERE user_id IS NOT NULL;

DROP POLICY IF EXISTS anon_select_saved_venues ON public.saved_venues;
DROP POLICY IF EXISTS anon_insert_saved_venues ON public.saved_venues;
DROP POLICY IF EXISTS anon_delete_saved_venues ON public.saved_venues;
DROP POLICY IF EXISTS saved_select_own ON public.saved_venues;
DROP POLICY IF EXISTS saved_insert_own ON public.saved_venues;
DROP POLICY IF EXISTS saved_delete_own ON public.saved_venues;

CREATE POLICY saved_select_own ON public.saved_venues FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY saved_insert_own ON public.saved_venues FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
CREATE POLICY saved_delete_own ON public.saved_venues FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.saved_venues FROM anon, authenticated;
GRANT SELECT, DELETE ON public.saved_venues TO authenticated;
GRANT INSERT (venue_id) ON public.saved_venues TO authenticated;

-- ============================================================================
-- >>> 20261014100000_backend_reactions_and_snaps.sql
-- ============================================================================
/*
# Pulse backend 4/4 — emoji reactions (posts + venues) and camera snaps

Idempotent. Apply after migrations 1-3.

## Reactions
- `reaction_types`: the emoji palette (kind, emoji, label, sort, active). Add or retire emojis with a
  plain INSERT/UPDATE, no schema change. `reactions.kind` now references it (was a hard-coded CHECK of 3).
- `reactions` (posts): unchanged shape, now accepts any ACTIVE kind. REPLICA IDENTITY FULL so realtime
  DELETE events carry the emoji kind.
- `venue_reactions`: one "vibe" per user per venue. Counts only include the last 12 hours
  (`venue_vibe_counts`), so a venue's vibe reflects tonight, not last month.

## Snaps (camera posts)
- `posts` gains: kind ('post' | 'snap'), media_type ('image' | 'video'), media_width/height/duration_ms,
  media_meta (small jsonb: filter, geo label, ...), expires_at.
- A snap needs media, and expires 24 h after posting (set by the database, clients cannot choose it).
  Expired snaps disappear from everyone's feed; the author can still see their own.
- media_url must be a public URL inside the poster's own folder of the `post-media` bucket AND the file
  must really exist in Storage (upload first, then post). Set your project's storage origin once so the
  host is pinned too (blocks hot-linked / tracking images on other hosts):
      insert into public.app_config (key, value) values ('storage_base_url', 'https://<project-ref>.supabase.co')
      on conflict (key) do update set value = excluded.value;
  (For `supabase start` use http://127.0.0.1:54321.) Without it the host is not pinned (dev fallback).
- `post-media` bucket now accepts mp4 / webm / quicktime video (25 MB limit) as well as images.
- `expired_snap_paths()` lists storage paths of expired snaps for a cleanup job (service role only).
*/

-- ============================================================================
-- Reaction palette
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reaction_types (
  kind text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]{1,23}$'),
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  label text NOT NULL,
  sort integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.reaction_types (kind, emoji, label, sort) VALUES
  ('fire',   '🔥', 'Fire',     10),
  ('heart',  '❤️', 'Love',     20),
  ('party',  '🎉', 'Party',    30),
  ('laugh',  '😂', 'Funny',    40),
  ('wow',    '😮', 'Wow',      50),
  ('clap',   '👏', 'Applause', 60),
  ('dance',  '💃', 'Dancing',  70),
  ('music',  '🎶', 'Great music', 80),
  ('bottle', '🍾', 'Bottles',  90),
  ('cool',   '😎', 'Cool',    100)
ON CONFLICT (kind) DO NOTHING;

ALTER TABLE public.reaction_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reaction_types_select ON public.reaction_types;
CREATE POLICY reaction_types_select ON public.reaction_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS reaction_types_admin_write ON public.reaction_types;
CREATE POLICY reaction_types_admin_write ON public.reaction_types FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.reaction_types FROM anon, authenticated;
GRANT SELECT ON public.reaction_types TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.reaction_types TO authenticated;

-- reactions.kind: CHECK (fire|heart|party) -> FK to the palette
ALTER TABLE public.reactions DROP CONSTRAINT IF EXISTS reactions_kind_check;
ALTER TABLE public.reactions DROP CONSTRAINT IF EXISTS reactions_kind_fk;
ALTER TABLE public.reactions ADD CONSTRAINT reactions_kind_fk
  FOREIGN KEY (kind) REFERENCES public.reaction_types (kind) ON UPDATE CASCADE;

-- only ACTIVE emojis can be used for new/changed reactions
DROP POLICY IF EXISTS reactions_insert ON public.reactions;
CREATE POLICY reactions_insert ON public.reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.reaction_types t WHERE t.kind = reactions.kind AND t.active)
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.status = 'visible'));
DROP POLICY IF EXISTS reactions_update_own ON public.reactions;
CREATE POLICY reactions_update_own ON public.reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_active_user())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.reaction_types t WHERE t.kind = reactions.kind AND t.active));

ALTER TABLE public.reactions REPLICA IDENTITY FULL;

-- notification text uses the palette instead of a hard-coded CASE
CREATE OR REPLACE FUNCTION public.notify_on_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid; pname text; e text;
BEGIN
  SELECT user_id INTO author FROM public.posts WHERE id = NEW.post_id;
  SELECT display_name INTO pname FROM public.profiles WHERE id = NEW.user_id;
  SELECT emoji INTO e FROM public.reaction_types WHERE kind = NEW.kind;
  PERFORM public.notify_user(author, 'reaction',
    coalesce(pname, 'Someone') || ' reacted ' || coalesce(e, '👍') || ' to your post',
    '', NEW.user_id, NULL, NEW.post_id);
  RETURN NEW;
END $$;

-- ============================================================================
-- Venue vibes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.venue_reactions (
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL REFERENCES public.reaction_types (kind) ON UPDATE CASCADE,
  reacted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX IF NOT EXISTS venue_reactions_recent_idx ON public.venue_reactions (venue_id, reacted_at DESC);

CREATE OR REPLACE FUNCTION public.venue_reaction_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- changing the emoji = a fresh vibe; unrelated updates (maintenance) keep the timestamp
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN NEW.reacted_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_reactions_touch ON public.venue_reactions;
CREATE TRIGGER venue_reactions_touch BEFORE UPDATE ON public.venue_reactions
FOR EACH ROW EXECUTE FUNCTION public.venue_reaction_touch();

ALTER TABLE public.venue_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS venue_reactions_select ON public.venue_reactions;
CREATE POLICY venue_reactions_select ON public.venue_reactions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS venue_reactions_insert ON public.venue_reactions;
CREATE POLICY venue_reactions_insert ON public.venue_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.reaction_types t WHERE t.kind = venue_reactions.kind AND t.active));
DROP POLICY IF EXISTS venue_reactions_update_own ON public.venue_reactions;
CREATE POLICY venue_reactions_update_own ON public.venue_reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_active_user())
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.reaction_types t WHERE t.kind = venue_reactions.kind AND t.active));
DROP POLICY IF EXISTS venue_reactions_delete_own ON public.venue_reactions;
CREATE POLICY venue_reactions_delete_own ON public.venue_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.venue_reactions FROM anon, authenticated;
GRANT SELECT ON public.venue_reactions TO anon, authenticated;
GRANT INSERT (venue_id, kind) ON public.venue_reactions TO authenticated;
GRANT UPDATE (kind) ON public.venue_reactions TO authenticated;
GRANT DELETE ON public.venue_reactions TO authenticated;
ALTER TABLE public.venue_reactions REPLICA IDENTITY FULL;

CREATE OR REPLACE VIEW public.venue_vibe_counts AS
SELECT venue_id, kind, count(*)::int AS n
FROM public.venue_reactions
WHERE reacted_at > now() - interval '12 hours'
GROUP BY venue_id, kind;
GRANT SELECT ON public.venue_vibe_counts TO anon, authenticated;

-- ============================================================================
-- App config (server-side settings the database needs; not readable by clients)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;  -- no policies: only the SQL editor / service role / definer functions
REVOKE ALL ON public.app_config FROM anon, authenticated;

-- ============================================================================
-- Snaps: media columns on posts
-- ============================================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'post',
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_width integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS media_duration_ms integer,
  ADD COLUMN IF NOT EXISTS media_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_kind_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_kind_ck CHECK (kind IN ('post', 'snap'));
-- http is allowed so local Supabase (http://127.0.0.1:54321) works; the trigger below pins the real origin
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_https_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_https_ck CHECK (media_url IS NULL OR media_url ~ '^https?://') NOT VALID;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_type_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_type_ck CHECK (media_type IS NULL OR media_type IN ('image', 'video'));
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_consistency_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_consistency_ck CHECK (
  (media_url IS NULL AND media_type IS NULL) OR (media_url IS NOT NULL AND media_type IS NOT NULL)) NOT VALID;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_dims_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_dims_ck CHECK (
  (media_width IS NULL OR media_width BETWEEN 1 AND 4096) AND (media_height IS NULL OR media_height BETWEEN 1 AND 4096)
  AND (media_duration_ms IS NULL OR media_duration_ms BETWEEN 0 AND 60000)) NOT VALID;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_media_meta_size_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_media_meta_size_ck CHECK (
  jsonb_typeof(media_meta) = 'object' AND pg_column_size(media_meta) <= 2048) NOT VALID;

-- a snap may have no caption; a plain post still needs text
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_content_len_ck;
ALTER TABLE public.posts ADD CONSTRAINT posts_content_len_ck CHECK (
  char_length(content) <= 1000 AND (media_url IS NOT NULL OR char_length(btrim(content)) >= 1)) NOT VALID;

CREATE INDEX IF NOT EXISTS posts_expires_idx ON public.posts (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_snaps_idx ON public.posts (created_at DESC) WHERE kind = 'snap' AND status = 'visible';

-- who can see which posts: expired snaps vanish for everyone but their author (and admins)
DROP POLICY IF EXISTS posts_select ON public.posts;
CREATE POLICY posts_select ON public.posts FOR SELECT TO anon, authenticated
  USING (
    (status = 'visible' AND (expires_at IS NULL OR expires_at > now()))
    OR user_id = auth.uid()
    OR public.is_admin()
  );

REVOKE INSERT ON public.posts FROM authenticated;
GRANT INSERT (content, venue_id, event_id, media_url, kind, media_type, media_width, media_height,
              media_duration_ms, media_meta) ON public.posts TO authenticated;

-- insert-time rules (replaces the migration-3 version)
CREATE OR REPLACE FUNCTION public.posts_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  pname text;
  recent int;
  v public.venues;
  base text;
  objname text;
BEGIN
  IF uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000';
    END IF;
    RETURN NEW; -- SQL editor / service role (seeding)
  END IF;

  SELECT display_name INTO pname FROM public.profiles WHERE id = uid AND status = 'active';
  IF pname IS NULL THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;

  SELECT count(*) INTO recent FROM public.posts WHERE user_id = uid AND created_at > now() - interval '10 minutes';
  IF recent >= 10 THEN RAISE EXCEPTION 'slow down: too many posts' USING ERRCODE = '54000'; END IF;

  NEW.user_id := uid;
  NEW.user_name := pname;
  NEW.likes := 0;
  NEW.comments := 0;
  NEW.status := 'visible';
  NEW.is_official := false;
  NEW.venue_name := NULL;
  NEW.content := coalesce(NEW.content, '');

  -- media must live in the poster's own folder of our public bucket
  IF NEW.media_url IS NOT NULL THEN
    SELECT value INTO base FROM public.app_config WHERE key = 'storage_base_url';
    IF base IS NOT NULL THEN
      IF left(NEW.media_url, char_length(rtrim(base, '/') || '/storage/v1/object/public/post-media/' || uid::text || '/'))
         <> rtrim(base, '/') || '/storage/v1/object/public/post-media/' || uid::text || '/' THEN
        RAISE EXCEPTION 'media must be uploaded to your own post-media folder' USING ERRCODE = '22023';
      END IF;
    ELSIF position('/storage/v1/object/public/post-media/' || uid::text || '/' IN NEW.media_url) = 0 THEN
      RAISE EXCEPTION 'media must be uploaded to your own post-media folder' USING ERRCODE = '22023';
    END IF;
    -- the file must really be in Storage (upload first, then post)
    objname := substring(NEW.media_url FROM '/storage/v1/object/public/post-media/(.+)$');
    IF objname IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'post-media' AND o.name = objname) THEN
      RAISE EXCEPTION 'media file not found in storage: upload it before posting' USING ERRCODE = '22023';
    END IF;
    IF NEW.media_type IS NULL THEN RAISE EXCEPTION 'media_type is required with media' USING ERRCODE = '22023'; END IF;
  ELSE
    NEW.media_type := NULL; NEW.media_width := NULL; NEW.media_height := NULL; NEW.media_duration_ms := NULL;
    NEW.media_meta := '{}'::jsonb;
  END IF;

  -- snaps: need media, expire after 24 h (not client-controlled)
  IF NEW.kind = 'snap' THEN
    IF NEW.media_url IS NULL THEN RAISE EXCEPTION 'a snap needs a photo or video' USING ERRCODE = '22023'; END IF;
    NEW.expires_at := now() + interval '24 hours';
  ELSE
    NEW.expires_at := NULL;
  END IF;

  IF NEW.venue_id IS NOT NULL THEN
    SELECT * INTO v FROM public.venues WHERE id = NEW.venue_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;
    NEW.venue_name := v.name;
    NEW.is_official := v.is_verified AND EXISTS (
      SELECT 1 FROM public.venue_managers m WHERE m.venue_id = NEW.venue_id AND m.user_id = uid);
  END IF;
  RETURN NEW;
END $$;

-- cleanup helper for a scheduled job (Edge Function / script with the service role)
CREATE OR REPLACE FUNCTION public.expired_snap_paths()
RETURNS TABLE (path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT regexp_replace(media_url, '^.*/storage/v1/object/public/post-media/', '')
  FROM public.posts WHERE kind = 'snap' AND expires_at < now() - interval '1 hour' AND media_url IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.expired_snap_paths() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Storage: allow short videos in post-media
-- ============================================================================
UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
WHERE id = 'post-media';

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'venue_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_reactions;
  END IF;
END $$;

-- ============================================================================
-- >>> 20261017100000_backend_engagement_statuses_messages.sql
-- ============================================================================
/*
# Pulse backend 5/5 — engagement, Vibe Rep, statuses, direct messages

Idempotent. Apply after migrations 1-4.

## Post engagement
- `reposts` (+ `posts.reposts` counter): repost to your followers' feed, optional quote text.
- `post_views` + `record_post_views()` (+ `posts.views` counter): unique SIGNED-IN viewers, never the author.
- `saved_posts`: bookmarks, private to the user.
- "Like" = the existing 'heart' reaction (so likes and emoji reactions stay one system).
- `profile_stats.vibe_rep`: reactions earned on a user's posts and snaps (self-reactions and removed posts excluded).

## Statuses (24 h stories)
- `statuses` (id, user_id, media_url, media_type, caption, venue_id, created_at, expires_at); the database sets
  user_id and the 24 h expiry. Media must exist in the poster's own post-media folder (same rules as snaps).
- `status_views`: who has seen which status (drives the unseen ring; owners can see their viewers).
- Reports/moderation: 'status' is a report target; admins remove via `admin_delete_status`.

## Direct messages
- `conversations` (1:1, one per pair), `conversation_participants`, `messages`. Created only through RPCs.
- Secret / vanish mode (`conversations.vanish_mode`): messages sent while it is on vanish 15 s after the
  recipient reads them (24 h if never read). Expired messages are invisible immediately (RLS) and deleted by
  `purge_expired_messages()` (every minute when pg_cron is available).
  This cannot stop screenshots or copy/paste; it only removes the messages from Pulse.
*/

-- ============================================================================
-- Post engagement
-- ============================================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reposts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views integer NOT NULL DEFAULT 0;

-- reposts ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reposts (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  comment text CHECK (comment IS NULL OR char_length(comment) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS reposts_recent_idx ON public.reposts (created_at DESC);
CREATE INDEX IF NOT EXISTS reposts_user_idx ON public.reposts (user_id);

ALTER TABLE public.reposts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reposts_select ON public.reposts;
CREATE POLICY reposts_select ON public.reposts FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id));   -- only reposts of posts the caller can see
DROP POLICY IF EXISTS reposts_insert ON public.reposts;
CREATE POLICY reposts_insert ON public.reposts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.status = 'visible'));
DROP POLICY IF EXISTS reposts_delete_own ON public.reposts;
CREATE POLICY reposts_delete_own ON public.reposts FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.reposts FROM anon, authenticated;
GRANT SELECT ON public.reposts TO anon, authenticated;
GRANT INSERT (post_id, comment) ON public.reposts TO authenticated;
GRANT DELETE ON public.reposts TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_post_reposts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid := coalesce(NEW.post_id, OLD.post_id);
BEGIN
  UPDATE public.posts SET reposts = (SELECT count(*) FROM public.reposts WHERE post_id = pid) WHERE id = pid;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reposts_counter ON public.reposts;
CREATE TRIGGER reposts_counter AFTER INSERT OR DELETE ON public.reposts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_reposts();

CREATE OR REPLACE FUNCTION public.notify_on_repost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid; pname text;
BEGIN
  SELECT user_id INTO author FROM public.posts WHERE id = NEW.post_id;
  SELECT display_name INTO pname FROM public.profiles WHERE id = NEW.user_id;
  PERFORM public.notify_user(author, 'community', coalesce(pname, 'Someone') || ' reposted your post',
                             coalesce(left(NEW.comment, 120), ''), NEW.user_id, NULL, NEW.post_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reposts_notify ON public.reposts;
CREATE TRIGGER reposts_notify AFTER INSERT ON public.reposts
FOR EACH ROW EXECUTE FUNCTION public.notify_on_repost();

-- views -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_views (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;      -- no policies: written only by record_post_views()
REVOKE ALL ON public.post_views FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_post_views(p_post_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF p_post_ids IS NULL OR cardinality(p_post_ids) = 0 THEN RETURN 0; END IF;
  IF cardinality(p_post_ids) > 50 THEN p_post_ids := p_post_ids[1:50]; END IF;

  WITH ins AS (
    INSERT INTO public.post_views (post_id, user_id)
    SELECT p.id, uid FROM public.posts p
    WHERE p.id = ANY (p_post_ids) AND p.status = 'visible' AND (p.expires_at IS NULL OR p.expires_at > now())
      AND p.user_id IS DISTINCT FROM uid
    ON CONFLICT DO NOTHING
    RETURNING post_id
  )
  UPDATE public.posts x SET views = x.views + 1 FROM ins WHERE x.id = ins.post_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- bookmarks -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_posts (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS saved_posts_user_idx ON public.saved_posts (user_id, created_at DESC);
ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_posts_select_own ON public.saved_posts;
CREATE POLICY saved_posts_select_own ON public.saved_posts FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS saved_posts_insert_own ON public.saved_posts;
CREATE POLICY saved_posts_insert_own ON public.saved_posts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.status = 'visible'));
DROP POLICY IF EXISTS saved_posts_delete_own ON public.saved_posts;
CREATE POLICY saved_posts_delete_own ON public.saved_posts FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.saved_posts FROM anon, authenticated;
GRANT SELECT, DELETE ON public.saved_posts TO authenticated;
GRANT INSERT (post_id) ON public.saved_posts TO authenticated;

-- Vibe Rep ---------------------------------------------------------------------------
-- reactions earned on someone's posts and snaps (not their own reactions, not removed posts)
CREATE OR REPLACE VIEW public.profile_stats AS
SELECT p.id AS user_id,
       (SELECT count(*) FROM public.user_follows f WHERE f.followee_id = p.id) AS follower_count,
       (SELECT count(*) FROM public.user_follows f WHERE f.follower_id = p.id) AS following_count,
       (SELECT count(*) FROM public.posts x WHERE x.user_id = p.id AND x.status = 'visible') AS post_count,
       (SELECT count(*) FROM public.reactions r JOIN public.posts x ON x.id = r.post_id
         WHERE x.user_id = p.id AND r.user_id <> x.user_id AND x.status <> 'removed') AS vibe_rep
FROM public.profiles p WHERE p.status <> 'banned';
GRANT SELECT ON public.profile_stats TO anon, authenticated;

-- ============================================================================
-- Statuses (24 h stories)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url text NOT NULL CHECK (media_url ~ '^https?://'),
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 300),
  venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS statuses_user_idx ON public.statuses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS statuses_expires_idx ON public.statuses (expires_at);

CREATE OR REPLACE FUNCTION public.statuses_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  recent int;
  base text;
  objname text;
BEGIN
  IF uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
    RETURN NEW;  -- SQL editor / service role
  END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;

  SELECT count(*) INTO recent FROM public.statuses WHERE user_id = uid AND created_at > now() - interval '1 hour';
  IF recent >= 20 THEN RAISE EXCEPTION 'slow down: too many statuses' USING ERRCODE = '54000'; END IF;

  -- same media rules as snaps: your own folder, on our storage origin, and the file really exists
  SELECT value INTO base FROM public.app_config WHERE key = 'storage_base_url';
  IF base IS NOT NULL THEN
    IF left(NEW.media_url, char_length(rtrim(base, '/') || '/storage/v1/object/public/post-media/' || uid::text || '/'))
       <> rtrim(base, '/') || '/storage/v1/object/public/post-media/' || uid::text || '/' THEN
      RAISE EXCEPTION 'media must be uploaded to your own post-media folder' USING ERRCODE = '22023';
    END IF;
  ELSIF position('/storage/v1/object/public/post-media/' || uid::text || '/' IN NEW.media_url) = 0 THEN
    RAISE EXCEPTION 'media must be uploaded to your own post-media folder' USING ERRCODE = '22023';
  END IF;
  objname := substring(NEW.media_url FROM '/storage/v1/object/public/post-media/(.+)$');
  IF objname IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'post-media' AND o.name = objname) THEN
    RAISE EXCEPTION 'media file not found in storage: upload it before posting' USING ERRCODE = '22023';
  END IF;

  NEW.user_id := uid;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '24 hours';
  NEW.caption := nullif(btrim(coalesce(NEW.caption, '')), '');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS statuses_prepare ON public.statuses;
CREATE TRIGGER statuses_prepare BEFORE INSERT ON public.statuses
FOR EACH ROW EXECUTE FUNCTION public.statuses_prepare();

ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS statuses_select ON public.statuses;
CREATE POLICY statuses_select ON public.statuses FOR SELECT TO anon, authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
    OR (expires_at > now() AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = user_id))  -- banned authors are hidden by profiles RLS
  );
DROP POLICY IF EXISTS statuses_insert ON public.statuses;
CREATE POLICY statuses_insert ON public.statuses FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS statuses_delete ON public.statuses;
CREATE POLICY statuses_delete ON public.statuses FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_admin());
REVOKE ALL ON public.statuses FROM anon, authenticated;
GRANT SELECT ON public.statuses TO anon, authenticated;
GRANT INSERT (media_url, media_type, caption, venue_id) ON public.statuses TO authenticated;
GRANT DELETE ON public.statuses TO authenticated;

CREATE TABLE IF NOT EXISTS public.status_views (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS status_views_viewer_idx ON public.status_views (viewer_id);
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS status_views_select ON public.status_views;
CREATE POLICY status_views_select ON public.status_views FOR SELECT TO authenticated
  USING (viewer_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id = auth.uid()));
DROP POLICY IF EXISTS status_views_insert ON public.status_views;
CREATE POLICY status_views_insert ON public.status_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid() AND EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.expires_at > now()));
REVOKE ALL ON public.status_views FROM anon, authenticated;
GRANT SELECT ON public.status_views TO authenticated;
GRANT INSERT (status_id) ON public.status_views TO authenticated;

CREATE OR REPLACE FUNCTION public.expired_status_paths()
RETURNS TABLE (path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT regexp_replace(media_url, '^.*/storage/v1/object/public/post-media/', '')
  FROM public.statuses WHERE expires_at < now() - interval '1 hour'
$$;
REVOKE EXECUTE ON FUNCTION public.expired_status_paths() FROM PUBLIC, anon, authenticated;

-- moderation: 'status' becomes a report target and admins can remove one ----------------------
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'user', 'venue', 'event', 'review', 'status'));

CREATE OR REPLACE FUNCTION public.admin_delete_status(p_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE author uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.statuses WHERE id = p_id RETURNING user_id INTO author;
  IF NOT FOUND THEN RAISE EXCEPTION 'status not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.notify_user(author, 'moderation', 'Your status was removed',
    coalesce(p_note, 'It broke the Pulse community guidelines.'), NULL, NULL, NULL, NULL, 'always');
  PERFORM public.log_admin_action('remove_status', 'status', p_id, p_note);
END $$;

CREATE OR REPLACE VIEW public.admin_report_queue AS
SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
       rp.display_name AS reporter_name,
       CASE r.target_type
         WHEN 'post' THEN (SELECT left(p.content, 200) FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT left(c.body, 200) FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT left(coalesce(v.body, ''), 200) FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'status' THEN (SELECT coalesce(s.caption, '(' || s.media_type || ' status)') FROM public.statuses s WHERE s.id = r.target_id)
         WHEN 'user' THEN (SELECT u.display_name FROM public.profiles u WHERE u.id = r.target_id)
         WHEN 'venue' THEN (SELECT x.name FROM public.venues x WHERE x.id = r.target_id)
         WHEN 'event' THEN (SELECT e.title FROM public.events e WHERE e.id = r.target_id)
       END AS target_preview,
       CASE r.target_type
         WHEN 'post' THEN (SELECT p.user_id FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT c.user_id FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT v.user_id FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'status' THEN (SELECT s.user_id FROM public.statuses s WHERE s.id = r.target_id)
         WHEN 'user' THEN r.target_id
       END AS target_user_id
FROM public.reports r
LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
WHERE public.is_admin();
GRANT SELECT ON public.admin_report_queue TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id uuid, p_action text, p_note text DEFAULT NULL, p_remove_content boolean DEFAULT false)
RETURNS public.reports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reports;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('actioned', 'dismissed') THEN RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023'; END IF;

  UPDATE public.reports SET status = p_action, handled_by = auth.uid(), handled_at = now(), note = p_note
  WHERE id = p_report_id AND status = 'open' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'report not found or already handled' USING ERRCODE = 'P0002'; END IF;

  IF p_action = 'actioned' AND p_remove_content THEN
    IF r.target_type IN ('post', 'comment', 'review') THEN
      PERFORM public.admin_set_content_status(r.target_type, r.target_id, 'removed', p_note);
    ELSIF r.target_type = 'status' THEN
      PERFORM public.admin_delete_status(r.target_id, p_note);
    END IF;
  END IF;
  PERFORM public.log_admin_action('resolve_report_' || p_action, 'report', r.id, p_note);
  RETURN r;
END $$;

-- ============================================================================
-- Direct messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direct_key text NOT NULL UNIQUE,
  vanish_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON public.conversation_participants (user_id);
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  ref_type text CHECK (ref_type IS NULL OR ref_type IN ('post', 'status')),
  ref_id uuid,
  vanish boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT messages_ref_ck CHECK ((ref_type IS NULL) = (ref_id IS NULL))
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_expiry_idx ON public.messages (expires_at) WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conv uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = p_conv AND user_id = auth.uid());
END $$;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.messages_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v boolean;
  recent int;
BEGIN
  IF uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
    RETURN NEW;
  END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;

  SELECT vanish_mode INTO v FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002'; END IF;

  NEW.sender_id := uid;
  NEW.read_at := NULL;
  IF NEW.kind = 'text' THEN
    SELECT count(*) INTO recent FROM public.messages
    WHERE sender_id = uid AND kind = 'text' AND created_at > now() - interval '1 minute';
    IF recent >= 30 THEN RAISE EXCEPTION 'slow down: too many messages' USING ERRCODE = '54000'; END IF;
    IF EXISTS (SELECT 1 FROM public.conversation_participants cp JOIN public.profiles pr ON pr.id = cp.user_id
               WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> uid AND pr.status = 'banned') THEN
      RAISE EXCEPTION 'recipient unavailable' USING ERRCODE = '42501';
    END IF;
    NEW.vanish := coalesce(v, false);
    NEW.expires_at := CASE WHEN NEW.vanish THEN now() + interval '24 hours' END;   -- shortened when read
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_prepare ON public.messages;
CREATE TRIGGER messages_prepare BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_prepare();

CREATE OR REPLACE FUNCTION public.messages_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messages_touch_conversation ON public.messages;
CREATE TRIGGER messages_touch_conversation AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_after_insert();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT TO authenticated USING (public.is_conversation_member(id));
REVOKE ALL ON public.conversations FROM anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS participants_select ON public.conversation_participants;
CREATE POLICY participants_select ON public.conversation_participants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_conversation_member(conversation_id));
REVOKE ALL ON public.conversation_participants FROM anon, authenticated;
GRANT SELECT ON public.conversation_participants TO authenticated;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id) AND (expires_at IS NULL OR expires_at > now()));
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id) AND public.is_active_user());
DROP POLICY IF EXISTS messages_delete_own ON public.messages;
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() AND kind = 'text' AND public.is_conversation_member(conversation_id));
REVOKE ALL ON public.messages FROM anon, authenticated;
GRANT SELECT ON public.messages TO authenticated;
GRANT INSERT (conversation_id, body, ref_type, ref_id) ON public.messages TO authenticated;
GRANT DELETE ON public.messages TO authenticated;

-- RPCs -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  k text;
  cid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF p_other IS NULL OR p_other = uid THEN RAISE EXCEPTION 'choose someone else to message' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_other AND status <> 'banned') THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;

  k := least(uid::text, p_other::text) || ':' || greatest(uid::text, p_other::text);
  INSERT INTO public.conversations (direct_key) VALUES (k) ON CONFLICT (direct_key) DO NOTHING;
  SELECT id INTO cid FROM public.conversations WHERE direct_key = k;
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (cid, uid), (cid, p_other) ON CONFLICT DO NOTHING;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.set_vanish_mode(p_conv uuid, p_on boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  pname text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_conversation_member(p_conv) THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.conversations SET vanish_mode = p_on WHERE id = p_conv AND vanish_mode IS DISTINCT FROM p_on;
  IF FOUND THEN
    SELECT display_name INTO pname FROM public.profiles WHERE id = uid;
    INSERT INTO public.messages (conversation_id, sender_id, body, kind)
    VALUES (p_conv, uid, coalesce(pname, 'Someone') || CASE WHEN p_on THEN ' turned on vanish mode. New messages disappear after they are read.'
                                                             ELSE ' turned off vanish mode.' END, 'system');
  END IF;
  RETURN p_on;
END $$;

-- Mark everything from the other person as read. In vanish mode those messages self-destruct shortly after.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  n integer;
  secs integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_conversation_member(p_conv) THEN RAISE EXCEPTION 'conversation not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce((SELECT value::int FROM public.app_config WHERE key = 'vanish_seconds'), 15) INTO secs;

  UPDATE public.messages
  SET read_at = now(),
      expires_at = CASE WHEN vanish THEN now() + make_interval(secs => secs) ELSE expires_at END
  WHERE conversation_id = p_conv AND sender_id <> uid AND read_at IS NULL AND kind = 'text'
    AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.conversation_participants SET last_read_at = now() WHERE conversation_id = p_conv AND user_id = uid;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.unread_message_count()
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int FROM public.messages m
  WHERE m.sender_id <> auth.uid() AND m.read_at IS NULL AND m.kind = 'text' AND (m.expires_at IS NULL OR m.expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public.list_conversations()
RETURNS TABLE (conversation_id uuid, other_user_id uuid, vanish_mode boolean, last_message_at timestamptz,
               last_body text, last_sender_id uuid, last_kind text, last_vanish boolean, unread_count integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id, o.user_id, c.vanish_mode, c.last_message_at, lm.body, lm.sender_id, lm.kind, lm.vanish,
         (SELECT count(*)::int FROM public.messages m
           WHERE m.conversation_id = c.id AND m.sender_id <> auth.uid() AND m.read_at IS NULL AND m.kind = 'text'
             AND (m.expires_at IS NULL OR m.expires_at > now()))
  FROM public.conversations c
  JOIN public.conversation_participants me ON me.conversation_id = c.id AND me.user_id = auth.uid()
  JOIN public.conversation_participants o ON o.conversation_id = c.id AND o.user_id <> auth.uid()
  LEFT JOIN LATERAL (
    SELECT m.body, m.sender_id, m.kind, m.vanish FROM public.messages m
    WHERE m.conversation_id = c.id AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.created_at DESC LIMIT 1) lm ON true
  ORDER BY c.last_message_at DESC
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_messages()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.messages WHERE expires_at IS NOT NULL AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available (%). Enable it in Dashboard > Database > Extensions, then re-run this block.', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pulse-purge-expired-messages';
    PERFORM cron.schedule('pulse-purge-expired-messages', '* * * * *', 'SELECT public.purge_expired_messages()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule message purge: %', SQLERRM;
END $$;

-- ============================================================================
-- Function privileges
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.record_post_views(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_status(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_vanish_mode(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unread_message_count() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_conversations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_messages() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.messages_prepare() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.messages_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.statuses_prepare() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_reposts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_repost() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_views(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_vanish_mode(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unread_message_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_conversations() TO authenticated;

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'conversations', 'statuses', 'reposts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- >>> 20261019100000_verification_roles.sql
-- ============================================================================
/*
# Pulse backend 6 — performer / staff roles on verification requests

Idempotent. Apply after migrations 1-5.

- `verification_requests.role`: what a 'host' (Performer / Staff) request is for:
  Manager, Host, Mc, Dj, Promoter, Musician, Dancer (exact spelling, shown as-is in the app).
- New 'host' requests must name a role; requests made before this migration keep role NULL (constraint is NOT VALID).
  Venue requests carry no role.
- The approval notification names the role ("Your Mc account is now verified.").
*/

ALTER TABLE public.verification_requests ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.verification_requests DROP CONSTRAINT IF EXISTS verification_role_ck;
ALTER TABLE public.verification_requests ADD CONSTRAINT verification_role_ck CHECK (
  CASE kind
    -- coalesce: NULL IN (...) is NULL, which a CHECK would let through
    WHEN 'host' THEN coalesce(role IN ('Manager', 'Host', 'Mc', 'Dj', 'Promoter', 'Musician', 'Dancer'), false)
    ELSE role IS NULL
  END
) NOT VALID;

GRANT INSERT (role) ON public.verification_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_verification(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS public.verification_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.verification_requests;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;

  SELECT * INTO r FROM public.verification_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already reviewed' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.verification_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(), reviewed_at = now(), note = p_note
  WHERE id = p_request_id RETURNING * INTO r;

  IF p_approve THEN
    UPDATE public.profiles SET account_type = r.kind, is_verified = true WHERE id = r.user_id;
    IF r.kind = 'venue' THEN
      INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (r.venue_id, r.user_id, 'owner')
      ON CONFLICT DO NOTHING;
      UPDATE public.venues SET is_verified = true WHERE id = r.venue_id;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (r.user_id, 'system',
          CASE WHEN p_approve THEN 'Verification approved' ELSE 'Verification not approved' END,
          CASE WHEN p_approve THEN 'Your ' || coalesce(r.role, r.kind) || ' account is now verified.'
               ELSE coalesce(nullif(p_note, ''), 'Your request was not approved this time.') END);

  PERFORM public.log_admin_action(CASE WHEN p_approve THEN 'approve_verification' ELSE 'reject_verification' END,
                                  'verification_request', r.id, p_note);
  RETURN r;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261019110000_venue_is_live.sql
-- ============================================================================
/*
# Pulse backend 7 — `is_live` on venues_public

Idempotent. Apply after migrations 1-6.

`venues.status` (set with `set_venue_status`, by a venue's managers or an admin) stays the single source of truth.
`venues_public.is_live` is derived from it, so it can never disagree with the status or outlive its expiry:
- true when the venue's effective status is 'live' (not expired), or
- when a published event at the venue is running now (same window as `events_feed.phase = 'live_now'`),
  unless the venue is marked 'sold_out'.

`events` joins the realtime publication so an event starting or being cancelled refreshes the app too
(the app also re-checks every minute, which covers start and end times passing).
*/

CREATE OR REPLACE VIEW public.venues_public WITH (security_invoker = true) AS
WITH v AS (
  SELECT v.*,
         CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
              THEN 'not_active' ELSE v.status END AS effective_status
  FROM public.venues v
)
SELECT v.id, v.name, v.slug, v.location, v.address, v.description, v.image_url,
       v.latitude, v.longitude, v.phone, v.whatsapp, v.is_verified, v.created_at,
       v.effective_status AS status,
       CASE WHEN v.effective_status = 'not_active' THEN NULL ELSE v.status_expires_at END AS status_expires_at,
       v.status_updated_at,
       (v.effective_status = 'live'
        OR (v.effective_status <> 'sold_out' AND EXISTS (
              SELECT 1 FROM public.events e
              WHERE e.venue_id = v.id AND e.status = 'published'
                AND e.starts_at <= now() AND now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours')))) AS is_live
FROM v;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261020100000_security_hardening.sql
-- ============================================================================
/*
# Pulse backend — pre-deployment security hardening

- posts: authors could UPDATE `media_url` after posting. The own-folder / file-exists rules in `posts_prepare()`
  only run on INSERT, so an edit could point a post (or snap) at any external URL (tracking pixel, swapped
  image). The app never edits posts, so authors may now only edit `content`.
- venues.image_url, events.cover_image_url, events.ticket_url: no format check, so a venue manager could store
  `javascript:` / `data:` URLs. They must now be http(s) URLs; existing values that are not are set to NULL.

Idempotent.
*/

-- ============================================================================
-- posts: content is the only editable column
-- ============================================================================
REVOKE UPDATE ON public.posts FROM anon, authenticated;
GRANT UPDATE (content) ON public.posts TO authenticated;

-- ============================================================================
-- URL columns written by venue managers
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('venues', 'image_url', 'venues_image_url_ck'),
      ('events', 'cover_image_url', 'events_cover_image_url_ck'),
      ('events', 'ticket_url', 'events_ticket_url_ck')) v(t, c, name) LOOP
    CONTINUE WHEN to_regclass('public.' || r.t) IS NULL;
    -- a NOT VALID check still applies to every later UPDATE of the row (e.g. set_venue_status), so a value that
    -- would fail it (written while the table was still open to anon) is cleared first; it could not render anyway
    EXECUTE format($f$UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL AND %I !~* '^https?://'$f$, r.t, r.c, r.c, r.c);
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || r.t)::regclass AND conname = r.name);
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I ~* '^https?://') NOT VALID$f$,
                   r.t, r.name, r.c, r.c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261022100000_multi_venue_management.sql
-- ============================================================================
/*
# Pulse backend 9 — multi-venue management (hosts and venue managers)

Idempotent and additive: no rows are deleted, no auth settings are touched. Apply after migration 8.

`venue_managers` already links a user to any number of venues (primary key `(venue_id, user_id)`), and
`manages_venue()` already gates venue edits, events and status changes. This migration:

- venue_managers: adds the `host` role next to `owner` / `manager`. A host (resident DJ, MC, promoter) can be
  linked to several clubs and has the same venue rights as a manager. Assignments stay admin-only (`vm_admin_write`):
    INSERT INTO public.venue_managers (venue_id, user_id, role)
    SELECT v.id, u.id, 'host' FROM public.venues v, auth.users u
    WHERE v.name IN ('Nomad', 'Taboo') AND u.email = 'host@example.com' ON CONFLICT DO NOTHING;
- venues: managers edit the profile (image, description/bio, address, phone, WhatsApp, map pin) of every venue they
  are linked to. Same rule as migration 3, restated here so the policy and grant sit next to the feature that uses them.
- posts: `as_venue` lets a linked user publish *as* the venue. The author name becomes the venue's name; `user_id`
  still records who wrote it (moderation, rate limits, deletes). Only real `venue_managers` rows qualify (admins are
  not implicitly every venue). The Official badge rule is unchanged (linked user + verified venue).
*/

-- ============================================================================
-- venue_managers: host role
-- ============================================================================
ALTER TABLE public.venue_managers DROP CONSTRAINT IF EXISTS venue_managers_role_check;
ALTER TABLE public.venue_managers ADD CONSTRAINT venue_managers_role_check CHECK (role IN ('owner', 'manager', 'host'));

-- ============================================================================
-- venues: linked users edit their venues' profiles
-- ============================================================================
DROP POLICY IF EXISTS venues_update_managers ON public.venues;
CREATE POLICY venues_update_managers ON public.venues FOR UPDATE TO authenticated
  USING (public.manages_venue(id)) WITH CHECK (public.manages_venue(id));
GRANT UPDATE (description, address, phone, whatsapp, image_url, latitude, longitude) ON public.venues TO authenticated;

-- ============================================================================
-- posts: publish as a venue
-- ============================================================================
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS as_venue boolean NOT NULL DEFAULT false;

-- Runs after posts_prepare (BEFORE triggers fire in name order), which has already stamped user_name / venue_name.
CREATE OR REPLACE FUNCTION public.posts_prepare_as_venue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NOT NEW.as_venue THEN RETURN NEW; END IF;
  IF NEW.venue_id IS NULL THEN RAISE EXCEPTION 'choose a venue to post as' USING ERRCODE = '22023'; END IF;
  IF uid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.venue_managers m WHERE m.venue_id = NEW.venue_id AND m.user_id = uid) THEN
    RAISE EXCEPTION 'you do not manage this venue' USING ERRCODE = '42501';
  END IF;
  NEW.user_name := (SELECT name FROM public.venues WHERE id = NEW.venue_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS posts_prepare_as_venue ON public.posts;
CREATE TRIGGER posts_prepare_as_venue BEFORE INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.posts_prepare_as_venue();

REVOKE INSERT ON public.posts FROM authenticated;
GRANT INSERT (content, venue_id, event_id, media_url, kind, media_type, media_width, media_height,
              media_duration_ms, media_meta, as_venue) ON public.posts TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261022110000_admin_venue_staff.sql
-- ============================================================================
/*
# Pulse backend 10 — admin: link users to venues as Manager or Host

Idempotent and additive. Apply after migration 9.

- `admin_find_users(q)`: admins look a user up by display name (partial match) or by email (exact match,
  case-insensitive). The email is only compared, never returned, so it stays out of every API response.
- `admin_assign_venue_staff(user, venue, role)`: links a user to a venue as 'manager' or 'host' (re-assigning
  changes the role). 'owner' stays reserved for approved venue verification requests.
- `admin_unassign_venue_staff(user, venue)`: removes the link.
Both write to `moderation_log`. Reading the assignment list uses the existing `vm_select` policy (admins see all rows).
*/

CREATE OR REPLACE FUNCTION public.admin_find_users(p_query text)
RETURNS TABLE (id uuid, display_name text, avatar_url text, account_type text, is_verified boolean, status text, matched_email boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q text := btrim(coalesce(p_query, ''));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF char_length(q) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, p.account_type::text, p.is_verified, p.status::text,
           lower(u.email) = lower(q) AS matched_email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE lower(u.email) = lower(q)
       OR p.display_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    ORDER BY (lower(u.email) = lower(q)) DESC, p.display_name
    LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_venue_staff(p_user_id uuid, p_venue_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  vname text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('manager', 'host') THEN RAISE EXCEPTION 'role must be manager or host' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT name INTO vname FROM public.venues WHERE id = p_venue_id;
  IF vname IS NULL THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (p_venue_id, p_user_id, p_role)
  ON CONFLICT (venue_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  PERFORM public.log_admin_action('assign_venue_staff', 'user', p_user_id, p_role || ' of ' || vname);
END $$;

CREATE OR REPLACE FUNCTION public.admin_unassign_venue_staff(p_user_id uuid, p_venue_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.venue_managers WHERE venue_id = p_venue_id AND user_id = p_user_id RETURNING role INTO removed;
  IF removed IS NULL THEN RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.log_admin_action('unassign_venue_staff', 'user', p_user_id,
    removed || ' of ' || (SELECT name FROM public.venues WHERE id = p_venue_id));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_find_users(text), public.admin_assign_venue_staff(uuid, uuid, text),
  public.admin_unassign_venue_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_users(text), public.admin_assign_venue_staff(uuid, uuid, text),
  public.admin_unassign_venue_staff(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261023100000_venue_logo.sql
-- ============================================================================
/*
# Pulse backend 11 — venue logo

Idempotent and additive. Apply after migration 10.

- venues.logo_url: a square logo / profile picture, next to the existing `image_url` cover photo. Like
  `image_url` (migration 8) it must be an http(s) URL.
- Linked hosts/managers and admins edit it through the same `venues_update_managers` policy as the rest of the
  venue profile (migration 9; `manages_venue()` includes admins).
- venues_public exposes it as its last column (CREATE OR REPLACE VIEW can only add columns at the end); the
  rest of the view is unchanged from migration 7.
*/

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS logo_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.venues'::regclass AND conname = 'venues_logo_url_ck') THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_logo_url_ck CHECK (logo_url IS NULL OR logo_url ~* '^https?://');
  END IF;
END $$;

GRANT UPDATE (logo_url) ON public.venues TO authenticated;

CREATE OR REPLACE VIEW public.venues_public WITH (security_invoker = true) AS
WITH v AS (
  SELECT v.*,
         CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
              THEN 'not_active' ELSE v.status END AS effective_status
  FROM public.venues v
)
SELECT v.id, v.name, v.slug, v.location, v.address, v.description, v.image_url,
       v.latitude, v.longitude, v.phone, v.whatsapp, v.is_verified, v.created_at,
       v.effective_status AS status,
       CASE WHEN v.effective_status = 'not_active' THEN NULL ELSE v.status_expires_at END AS status_expires_at,
       v.status_updated_at,
       (v.effective_status = 'live'
        OR (v.effective_status <> 'sold_out' AND EXISTS (
              SELECT 1 FROM public.events e
              WHERE e.venue_id = v.id AND e.status = 'published'
                AND e.starts_at <= now() AND now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours')))) AS is_live,
       v.logo_url
FROM v;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261024100000_register_venue.sql
-- ============================================================================
/*
# Pulse backend 12 — self-service venue registration

Idempotent and additive. Apply after migration 11.

- venues.created_by: who registered the venue (NULL for venues created before this migration or by admins).
- `register_venue(name, location, description, image_url, logo_url)`: any active signed-in user creates a venue
  and is linked to it as its 'manager' in the same transaction, so they can edit it and set its status at once.
  - The venue starts unverified (`is_verified = false`, so no Official badge) and Not active.
  - Name and location: 2-60 characters. Description: up to 500. Images must be http(s) (same checks as migrations 8, 11).
  - A venue with the same name in the same location already exists -> 23505 (claim it through a verification
    request instead of registering a duplicate).
  - At most 3 registrations per user per 24 hours -> 54000.
  Admins can still rename, verify or unlink through the existing admin tools.
*/

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS venues_created_by_idx ON public.venues (created_by, created_at) WHERE created_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_venue(
  p_name text, p_location text, p_description text DEFAULT NULL, p_image_url text DEFAULT NULL, p_logo_url text DEFAULT NULL)
RETURNS public.venues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  vname text := btrim(coalesce(p_name, ''));
  vloc text := btrim(coalesce(p_location, ''));
  vdesc text := nullif(btrim(coalesce(p_description, '')), '');
  v public.venues;
  base text;
  candidate text;
  n int := 1;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF char_length(vname) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'venue name must be 2-60 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(vloc) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'location must be 2-60 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(vdesc, '')) > 500 THEN RAISE EXCEPTION 'description is too long' USING ERRCODE = '22023'; END IF;

  IF EXISTS (SELECT 1 FROM public.venues WHERE lower(name) = lower(vname) AND lower(location) = lower(vloc)) THEN
    RAISE EXCEPTION 'a venue with this name already exists in this location' USING ERRCODE = '23505';
  END IF;
  IF (SELECT count(*) FROM public.venues WHERE created_by = uid AND created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'slow down: too many venues registered today' USING ERRCODE = '54000';
  END IF;

  base := coalesce(nullif(lower(btrim(regexp_replace(vname, '[^a-zA-Z0-9]+', '-', 'g'), '-')), ''), 'venue');
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.venues WHERE slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;

  -- image/logo format is enforced by venues_image_url_ck / venues_logo_url_ck
  INSERT INTO public.venues (name, location, slug, status, description, image_url, logo_url, is_verified, created_by)
  VALUES (vname, vloc, candidate, 'not_active', vdesc, nullif(btrim(coalesce(p_image_url, '')), ''),
          nullif(btrim(coalesce(p_logo_url, '')), ''), false, uid)
  RETURNING * INTO v;

  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (v.id, uid, 'manager');
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION public.register_venue(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_venue(text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261025100000_self_service_controls.sql
-- ============================================================================
/*
# Pulse backend 13 — self-service edit / delete controls and admin overrides

Idempotent and additive. Apply after migration 12. Nothing existing is changed except venues_public, which gains
`created_by` as its last column (CREATE OR REPLACE VIEW can only add columns at the end; the base table is already
readable).

Signed-in users:
- `relinquish_my_role()`: drop your Performer / Staff or Venue account role and its badge (back to a plain user).
  Venue links and pending requests are untouched.
- `leave_venue(venue)`: unlink yourself from a venue you are linked to (owner / manager / host).
- `rename_my_venue(venue, name, location)`: the person who registered a venue (migration 12) can change its name
  and location, with the same 2-60 character and no-duplicate rules as registering.
- `delete_my_venue(venue)`: the person who registered a venue deletes it for good. Its events, reviews, follows,
  vibes, saves and staff links go with it (ON DELETE CASCADE); posts stay, without the venue tag (SET NULL).
  Linked managers who did not create it cannot delete it.

Admins (all logged in moderation_log):
- `admin_delete_venue(venue, note)`: delete any venue; everyone linked to it is told why.
- `admin_set_user_role(user, account_type, verified)`: set anyone's role ('user' | 'host' | 'venue') and badge.
  Venue links stay with admin_assign_venue_staff / admin_unassign_venue_staff (migration 10).
*/

CREATE OR REPLACE VIEW public.venues_public WITH (security_invoker = true) AS
WITH v AS (
  SELECT v.*,
         CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
              THEN 'not_active' ELSE v.status END AS effective_status
  FROM public.venues v
)
SELECT v.id, v.name, v.slug, v.location, v.address, v.description, v.image_url,
       v.latitude, v.longitude, v.phone, v.whatsapp, v.is_verified, v.created_at,
       v.effective_status AS status,
       CASE WHEN v.effective_status = 'not_active' THEN NULL ELSE v.status_expires_at END AS status_expires_at,
       v.status_updated_at,
       (v.effective_status = 'live'
        OR (v.effective_status <> 'sold_out' AND EXISTS (
              SELECT 1 FROM public.events e
              WHERE e.venue_id = v.id AND e.status = 'published'
                AND e.starts_at <= now() AND now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours')))) AS is_live,
       v.logo_url,
       v.created_by
FROM v;

-- ============================================================================
-- Signed-in users
-- ============================================================================
CREATE OR REPLACE FUNCTION public.relinquish_my_role()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pr public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  UPDATE public.profiles SET account_type = 'user', is_verified = false WHERE id = auth.uid() RETURNING * INTO pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002'; END IF;
  RETURN pr;
END $$;

CREATE OR REPLACE FUNCTION public.leave_venue(p_venue_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.venue_managers WHERE venue_id = p_venue_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'you are not linked to this venue' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rename_my_venue(p_venue_id uuid, p_name text, p_location text)
RETURNS public.venues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  vname text := btrim(coalesce(p_name, ''));
  vloc text := btrim(coalesce(p_location, ''));
  v public.venues;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'only the person who registered this venue can rename it' USING ERRCODE = '42501';
  END IF;
  IF char_length(vname) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'venue name must be 2-60 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(vloc) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'location must be 2-60 characters' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.venues WHERE id <> p_venue_id AND lower(name) = lower(vname) AND lower(location) = lower(vloc)) THEN
    RAISE EXCEPTION 'a venue with this name already exists in this location' USING ERRCODE = '23505';
  END IF;
  UPDATE public.venues SET name = vname, location = vloc WHERE id = p_venue_id RETURNING * INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.delete_my_venue(p_venue_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.venues WHERE id = p_venue_id AND created_by = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only the person who registered this venue can delete it' USING ERRCODE = '42501';
  END IF;
END $$;

-- ============================================================================
-- Admins
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_venue(p_venue_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  vname text;
  linked uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  SELECT name INTO vname FROM public.venues WHERE id = p_venue_id;
  IF vname IS NULL THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;
  -- tell the people who ran it before the links disappear with the venue
  FOR linked IN
    SELECT user_id FROM public.venue_managers WHERE venue_id = p_venue_id
    UNION SELECT created_by FROM public.venues WHERE id = p_venue_id AND created_by IS NOT NULL
  LOOP
    PERFORM public.notify_user(linked, 'moderation', vname || ' was removed from Pulse',
      coalesce(nullif(btrim(p_note), ''), 'An administrator removed this venue.'), NULL, NULL, NULL, NULL, 'always');
  END LOOP;
  DELETE FROM public.venues WHERE id = p_venue_id;
  PERFORM public.log_admin_action('delete_venue', 'venue', p_venue_id, concat_ws(': ', vname, nullif(btrim(p_note), '')));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_account_type text, p_verified boolean)
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pr public.profiles;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_account_type NOT IN ('user', 'host', 'venue') THEN RAISE EXCEPTION 'role must be user, host or venue' USING ERRCODE = '22023'; END IF;
  UPDATE public.profiles SET account_type = p_account_type, is_verified = coalesce(p_verified, false)
  WHERE id = p_user_id RETURNING * INTO pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.log_admin_action('set_user_role', 'user', p_user_id,
    p_account_type || CASE WHEN pr.is_verified THEN ', verified' ELSE ', not verified' END);
  RETURN pr;
END $$;

REVOKE EXECUTE ON FUNCTION public.relinquish_my_role(), public.leave_venue(uuid), public.rename_my_venue(uuid, text, text),
  public.delete_my_venue(uuid), public.admin_delete_venue(uuid, text), public.admin_set_user_role(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relinquish_my_role(), public.leave_venue(uuid), public.rename_my_venue(uuid, text, text),
  public.delete_my_venue(uuid), public.admin_delete_venue(uuid, text), public.admin_set_user_role(uuid, text, boolean)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261026100000_self_link_venues.sql
-- ============================================================================
/*
# Pulse backend 14 — hosts and venue accounts link themselves to venues

Idempotent and additive. Apply after migration 13. No existing policy is changed (vm_select and vm_admin_write stay).

- `vm_self_insert`: an active user whose account role is Performer / Staff ('host') or Venue account ('venue') can
  insert their own venue_managers row, for any number of venues, with no admin approval:
      insert into venue_managers (venue_id, user_id) values (<venue>, auth.uid())
  The row must be their own (user_id = auth.uid()) and its role 'manager' (the default) or 'host', never 'owner'.
  Account roles are only given by verification or an admin (users can not update profiles.account_type), so plain
  users, suspended and banned accounts can not link themselves. Leaving stays with leave_venue (migration 13).
*/

DROP POLICY IF EXISTS vm_self_insert ON public.venue_managers;
CREATE POLICY vm_self_insert ON public.venue_managers FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role IN ('manager', 'host')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status = 'active' AND p.account_type IN ('host', 'venue')
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261027100000_channels_snaps_phone.sql
-- ============================================================================
/*
# Pulse backend 15 — venue channels, chat snaps and chat filters, Vibe Check stories, phone numbers

Idempotent and additive. Apply after migration 14. No existing column, policy or function is changed or removed.

Venue channels (one per venue, WhatsApp-style broadcast channels):
- `venue_channels`: created and edited by the venue's linked staff (manages_venue: owner / manager / host) and
  admins. Everyone can read them. `follower_count` and `last_message_at` are kept by triggers.
- `channel_followers`: signed-in active users follow / unfollow channels; you only see your own rows.
- `channel_messages`: text and/or a photo / video, posted by the venue's staff (max 60 per channel per hour).
  Everyone can read; the author, the venue's staff and admins can delete. In Realtime.

Direct chats:
- `messages.media_url` / `media_type`: a private photo / video snap in a direct chat (http(s) only, both or neither).
  `body` stays required (the app sends the caption, or "📸 Snap").
- `conversation_participants.is_favorite` / `is_archived`: your own chat list filters (Favorites, Archived).
  You can only change your own row, and only these two columns.

Vibe Check stories:
- `vibe_check_stories`: a read-only view of live 24 h statuses with the tagged venue's name and area for the
  venue / time overlay. It runs with the reader's rights, so the statuses policies decide what you see.

Phone numbers (SMS one-time-code sign-in is switched on in the Supabase dashboard: Authentication > Providers > Phone):
- `profiles.phone_verified`: public flag for the "phone verified" handle. The number itself is private.
- `profile_phones`: a confirmed number per account, copied from auth.users by a trigger (digits only, unique).
  Only the owner and admins can read it. Email sign-in and admin access are unchanged.
- `find_user_by_phone(phone)`: signed-in active users start a chat by phone number (exact match); returns only the
  profile id, never the number, and nothing for banned accounts.
*/

-- ============================================================================
-- Direct chat snaps + chat list filters
-- ============================================================================
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url text, ADD COLUMN IF NOT EXISTS media_type text;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('messages_media_url_ck', $q$CHECK (media_url IS NULL OR media_url ~* '^https?://')$q$),
    ('messages_media_type_ck', $q$CHECK (media_type IS NULL OR media_type IN ('image', 'video'))$q$),
    ('messages_media_pair_ck', $q$CHECK ((media_url IS NULL) = (media_type IS NULL))$q$)
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.messages'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE public.messages ADD CONSTRAINT %I %s', c.name, c.def);
    END IF;
  END LOOP;
END $$;
GRANT INSERT (media_url, media_type) ON public.messages TO authenticated;

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS participants_update_own ON public.conversation_participants;
CREATE POLICY participants_update_own ON public.conversation_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT UPDATE (is_favorite, is_archived) ON public.conversation_participants TO authenticated;

-- ============================================================================
-- Venue channels
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.venue_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL UNIQUE REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  follower_count int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channel_followers (
  channel_id uuid NOT NULL REFERENCES public.venue_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS channel_followers_user_idx ON public.channel_followers (user_id);

CREATE TABLE IF NOT EXISTS public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.venue_channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body text CHECK (body IS NULL OR char_length(btrim(body)) BETWEEN 1 AND 2000),
  media_url text CHECK (media_url IS NULL OR media_url ~* '^https?://'),
  media_type text CHECK (media_type IS NULL OR media_type IN ('image', 'video')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_messages_content_ck CHECK (body IS NOT NULL OR media_url IS NOT NULL),
  CONSTRAINT channel_messages_media_pair_ck CHECK ((media_url IS NULL) = (media_type IS NULL))
);
CREATE INDEX IF NOT EXISTS channel_messages_channel_idx ON public.channel_messages (channel_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.manages_channel(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.venue_channels c WHERE c.id = p_channel_id AND public.manages_venue(c.venue_id));
$$;

CREATE OR REPLACE FUNCTION public.channel_followers_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.venue_channels SET follower_count = greatest(0, follower_count + CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END)
  WHERE id = coalesce(NEW.channel_id, OLD.channel_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS channel_followers_count ON public.channel_followers;
CREATE TRIGGER channel_followers_count AFTER INSERT OR DELETE ON public.channel_followers
FOR EACH ROW EXECUTE FUNCTION public.channel_followers_count();

CREATE OR REPLACE FUNCTION public.channel_messages_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;  -- SQL editor / service role
  NEW.author_id := uid;
  NEW.created_at := now();
  IF (SELECT count(*) FROM public.channel_messages
      WHERE channel_id = NEW.channel_id AND created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'slow down: too many channel posts' USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS channel_messages_prepare ON public.channel_messages;
CREATE TRIGGER channel_messages_prepare BEFORE INSERT ON public.channel_messages
FOR EACH ROW EXECUTE FUNCTION public.channel_messages_prepare();

CREATE OR REPLACE FUNCTION public.channel_messages_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.venue_channels SET last_message_at = NEW.created_at WHERE id = NEW.channel_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS channel_messages_touch ON public.channel_messages;
CREATE TRIGGER channel_messages_touch AFTER INSERT ON public.channel_messages
FOR EACH ROW EXECUTE FUNCTION public.channel_messages_touch();

ALTER TABLE public.venue_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS venue_channels_select ON public.venue_channels;
CREATE POLICY venue_channels_select ON public.venue_channels FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS venue_channels_insert ON public.venue_channels;
CREATE POLICY venue_channels_insert ON public.venue_channels FOR INSERT TO authenticated
  WITH CHECK (public.manages_venue(venue_id) AND public.is_active_user());
DROP POLICY IF EXISTS venue_channels_update ON public.venue_channels;
CREATE POLICY venue_channels_update ON public.venue_channels FOR UPDATE TO authenticated
  USING (public.manages_venue(venue_id)) WITH CHECK (public.manages_venue(venue_id));
DROP POLICY IF EXISTS venue_channels_delete ON public.venue_channels;
CREATE POLICY venue_channels_delete ON public.venue_channels FOR DELETE TO authenticated USING (public.manages_venue(venue_id));
REVOKE ALL ON public.venue_channels FROM anon, authenticated;
GRANT SELECT ON public.venue_channels TO anon, authenticated;
GRANT INSERT (venue_id, name, description), UPDATE (name, description), DELETE ON public.venue_channels TO authenticated;

ALTER TABLE public.channel_followers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_followers_select ON public.channel_followers;
CREATE POLICY channel_followers_select ON public.channel_followers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS channel_followers_insert ON public.channel_followers;
CREATE POLICY channel_followers_insert ON public.channel_followers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user());
DROP POLICY IF EXISTS channel_followers_delete ON public.channel_followers;
CREATE POLICY channel_followers_delete ON public.channel_followers FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.channel_followers FROM anon, authenticated;
GRANT SELECT, DELETE ON public.channel_followers TO authenticated;
GRANT INSERT (channel_id) ON public.channel_followers TO authenticated;

ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_messages_select ON public.channel_messages;
CREATE POLICY channel_messages_select ON public.channel_messages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS channel_messages_insert ON public.channel_messages;
CREATE POLICY channel_messages_insert ON public.channel_messages FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_active_user() AND public.manages_channel(channel_id));
DROP POLICY IF EXISTS channel_messages_delete ON public.channel_messages;
CREATE POLICY channel_messages_delete ON public.channel_messages FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.manages_channel(channel_id));
REVOKE ALL ON public.channel_messages FROM anon, authenticated;
GRANT SELECT ON public.channel_messages TO anon, authenticated;
GRANT INSERT (channel_id, body, media_url, media_type), DELETE ON public.channel_messages TO authenticated;

-- ============================================================================
-- Vibe Check stories (live statuses + venue for the overlay)
-- ============================================================================
-- a hand-made view with other columns cannot be replaced in place (it holds no data, so recreate it)
DROP VIEW IF EXISTS public.vibe_check_stories;
CREATE VIEW public.vibe_check_stories WITH (security_invoker = true) AS
SELECT s.id, s.user_id, s.media_url, s.media_type, s.caption, s.venue_id,
       v.name AS venue_name, v.location AS venue_location, s.created_at, s.expires_at
FROM public.statuses s
LEFT JOIN public.venues v ON v.id = s.venue_id
WHERE s.expires_at > now();
REVOKE ALL ON public.vibe_check_stories FROM anon, authenticated;
GRANT SELECT ON public.vibe_check_stories TO anon, authenticated;

-- ============================================================================
-- Phone numbers
-- ============================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.profile_phones (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^[0-9]{7,15}$'),
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_phones_select ON public.profile_phones;
CREATE POLICY profile_phones_select ON public.profile_phones FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
REVOKE ALL ON public.profile_phones FROM anon, authenticated;
GRANT SELECT ON public.profile_phones TO authenticated;

/** Digits only ("+256 700-000 000" -> "256700000000"), the form Supabase Auth stores. */
-- hand-made versions with another parameter name or return type cannot be replaced in place
DROP FUNCTION IF EXISTS public.find_user_by_phone(text);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'normalize_phone' AND pg_get_function_identity_arguments(p.oid) = 'p text') IS NOT TRUE THEN
    DROP FUNCTION IF EXISTS public.normalize_phone(text);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

CREATE OR REPLACE FUNCTION public.sync_profile_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p text := public.normalize_phone(NEW.phone);
BEGIN
  IF p IS NOT NULL AND p ~ '^[0-9]{7,15}$' AND NEW.phone_confirmed_at IS NOT NULL THEN
    -- a number moves to whoever confirmed it last
    UPDATE public.profiles SET phone_verified = false
    WHERE id IN (SELECT user_id FROM public.profile_phones WHERE phone = p AND user_id <> NEW.id);
    DELETE FROM public.profile_phones WHERE phone = p AND user_id <> NEW.id;
    INSERT INTO public.profile_phones (user_id, phone, verified_at) VALUES (NEW.id, p, NEW.phone_confirmed_at)
    ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, verified_at = EXCLUDED.verified_at;
    UPDATE public.profiles SET phone_verified = true WHERE id = NEW.id AND NOT phone_verified;
  ELSE
    DELETE FROM public.profile_phones WHERE user_id = NEW.id;
    UPDATE public.profiles SET phone_verified = false WHERE id = NEW.id AND phone_verified;
  END IF;
  RETURN NULL;
END $$;
-- runs after on_auth_user_created (triggers fire in name order), so a new phone user's profile already exists
DROP TRIGGER IF EXISTS on_auth_user_phone ON auth.users;
CREATE TRIGGER on_auth_user_phone AFTER INSERT OR UPDATE OF phone, phone_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_phone();

-- numbers confirmed before this migration
INSERT INTO public.profile_phones (user_id, phone, verified_at)
SELECT DISTINCT ON (public.normalize_phone(u.phone)) u.id, public.normalize_phone(u.phone), u.phone_confirmed_at
FROM auth.users u
WHERE u.phone_confirmed_at IS NOT NULL AND public.normalize_phone(u.phone) ~ '^[0-9]{7,15}$'
ORDER BY public.normalize_phone(u.phone), u.phone_confirmed_at DESC
ON CONFLICT DO NOTHING;
UPDATE public.profiles p SET phone_verified = true
WHERE EXISTS (SELECT 1 FROM public.profile_phones pp WHERE pp.user_id = p.id) AND NOT p.phone_verified;

CREATE FUNCTION public.find_user_by_phone(p_phone text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE found uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  SELECT pp.user_id INTO found
  FROM public.profile_phones pp JOIN public.profiles pr ON pr.id = pp.user_id
  WHERE pp.phone = public.normalize_phone(p_phone) AND pr.status <> 'banned';
  RETURN found;
END $$;

REVOKE EXECUTE ON FUNCTION public.channel_followers_count(), public.channel_messages_prepare(), public.channel_messages_touch(),
  public.sync_profile_phone() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_user_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manages_channel(uuid), public.normalize_phone(text) TO anon, authenticated;

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['venue_channels', 'channel_messages'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261028100000_voice_messages.sql
-- ============================================================================
/*
# Pulse backend 16 — voice messages in direct chats

Idempotent and additive. Apply after migration 15 (it extends the chat media columns that migration adds).

- `message-media` storage bucket: PRIVATE (no public URLs). Files live at `<conversation id>/<sender id>/<file>`.
  Only the two people in that conversation can read them (the app plays them through short-lived signed URLs);
  you can only upload into your own folder of a conversation you are in, and delete only your own files.
- `messages.media_type` now also accepts 'audio'. A voice note's `media_url` must point at your own folder of
  this conversation in `message-media`, and the file must already be uploaded.
- `messages.media_duration_ms` (up to 10 minutes) and `messages.media_waveform` (up to 64 bars, 0-100) so the
  bubble shows its length and waveform before the audio loads. Both optional.
*/

-- ============================================================================
-- Private bucket for chat voice notes
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('message-media', 'message-media', false, 10485760,
   ARRAY['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

/** The conversation folder of a message-media object name, if the signed-in user is in that conversation. */
CREATE OR REPLACE FUNCTION public.can_access_message_media(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id::text = (storage.foldername(p_name))[1] AND cp.user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_message_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_message_media(text) TO authenticated;

DROP POLICY IF EXISTS pulse_message_media_read ON storage.objects;
CREATE POLICY pulse_message_media_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-media' AND public.can_access_message_media(name));
DROP POLICY IF EXISTS pulse_message_media_insert ON storage.objects;
CREATE POLICY pulse_message_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-media' AND (storage.foldername(name))[2] = auth.uid()::text
              AND public.can_access_message_media(name) AND public.is_active_user());
DROP POLICY IF EXISTS pulse_message_media_delete ON storage.objects;
CREATE POLICY pulse_message_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'message-media' AND (storage.foldername(name))[2] = auth.uid()::text);

-- ============================================================================
-- Voice notes on messages
-- ============================================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_duration_ms integer,
  ADD COLUMN IF NOT EXISTS media_waveform smallint[];

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_media_type_ck;
ALTER TABLE public.messages ADD CONSTRAINT messages_media_type_ck CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'audio'));
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('messages_media_url_ck', $q$CHECK (media_url IS NULL OR media_url ~* '^https?://')$q$),
    ('messages_media_pair_ck', $q$CHECK ((media_url IS NULL) = (media_type IS NULL))$q$),
    ('messages_media_duration_ck', $q$CHECK (media_duration_ms IS NULL OR media_duration_ms BETWEEN 0 AND 600000)$q$),
    ('messages_media_waveform_ck', $q$CHECK (media_waveform IS NULL OR (cardinality(media_waveform) <= 64 AND 0 <= ALL (media_waveform) AND 100 >= ALL (media_waveform)))$q$)
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.messages'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE public.messages ADD CONSTRAINT %I %s', c.name, c.def);
    END IF;
  END LOOP;
END $$;
GRANT INSERT (media_url, media_type, media_duration_ms, media_waveform) ON public.messages TO authenticated;

/** A voice note must be a file you uploaded into your own folder of this conversation. */
CREATE OR REPLACE FUNCTION public.messages_check_audio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  folder text;
  objname text;
BEGIN
  IF NEW.media_type IS DISTINCT FROM 'audio' THEN
    NEW.media_duration_ms := NULL;
    NEW.media_waveform := NULL;
    RETURN NEW;
  END IF;
  IF uid IS NULL THEN RETURN NEW; END IF;  -- SQL editor / service role
  folder := NEW.conversation_id::text || '/' || uid::text || '/';
  objname := substring(NEW.media_url FROM '/storage/v1/object/(?:authenticated|sign|public)/message-media/([^?]+)');
  IF objname IS NULL OR left(objname, char_length(folder)) <> folder THEN
    RAISE EXCEPTION 'voice notes must be uploaded to your own message-media folder of this chat' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'message-media' AND o.name = objname) THEN
    RAISE EXCEPTION 'media file not found in storage: upload it before sending' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_check_audio() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_check_audio ON public.messages;
CREATE TRIGGER messages_check_audio BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_check_audio();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261029100000_phone_lookup_mapped.sql
-- ============================================================================
/*
# Pulse backend 17 — find people by phone number, including phone + password accounts

Idempotent. Apply after migration 15. It replaces any existing find_user_by_phone(text) (including a hand-made one
with another parameter name or return type) and does not depend on normalize_phone.

Phone + password sign-up (development, no SMS provider) stores the account as an email address made from the number,
e.g. "+256789175095" -> "256789175095@pulseapp.com". Those numbers are not in profile_phones (that table only
holds numbers confirmed by SMS), so "New chat" by number could not find anyone who signed up that way.

- app_config 'phone_email_domains': comma-separated domains the app maps numbers to (VITE_PHONE_EMAIL_DOMAIN).
  Default 'pulseapp.com,pulse.internal.com,pulse.local' (pulseapp.com is a third party's domain: development only).
  Change it with:
    insert into public.app_config (key, value) values ('phone_email_domains', 'users.example.com')
    on conflict (key) do update set value = excluded.value;
- find_user_by_phone(p_phone): an SMS-confirmed number wins; otherwise a phone + password account whose mapped
  address matches. Still returns only the profile id (never the number or the address), only to signed-in active
  users, and never banned accounts.
  Note: mapped numbers are not verified, so anyone can sign up with any number this way. Development only.
*/

INSERT INTO public.app_config (key, value) VALUES ('phone_email_domains', 'pulseapp.com,pulse.internal.com,pulse.local')
ON CONFLICT (key) DO NOTHING;
-- databases that ran an earlier copy of this migration: add the current default domain
UPDATE public.app_config SET value = 'pulseapp.com,' || value
WHERE key = 'phone_email_domains' AND NOT ('pulseapp.com' = ANY (string_to_array(replace(value, ' ', ''), ',')));

-- a hand-made version (e.g. find_user_by_phone(phone_input) returning rows, callable signed out) cannot be replaced
-- in place: drop it first
DROP FUNCTION IF EXISTS public.find_user_by_phone(text);

CREATE FUNCTION public.find_user_by_phone(p_phone text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  found uuid;
  digits text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  domains text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF digits IS NULL OR digits !~ '^[0-9]{7,15}$' THEN RETURN NULL; END IF;

  -- 1. confirmed by SMS
  SELECT pp.user_id INTO found
  FROM public.profile_phones pp JOIN public.profiles pr ON pr.id = pp.user_id
  WHERE pp.phone = digits AND pr.status <> 'banned';
  IF found IS NOT NULL THEN RETURN found; END IF;

  -- 2. phone + password account ("<digits>@<mapping domain>")
  SELECT coalesce(array_agg(lower(btrim(d))) FILTER (WHERE btrim(d) <> ''), '{}') INTO domains
  FROM unnest(string_to_array(coalesce((SELECT value FROM public.app_config WHERE key = 'phone_email_domains'), ''), ',')) AS d;
  IF cardinality(domains) = 0 THEN RETURN NULL; END IF;

  SELECT u.id INTO found
  FROM auth.users u JOIN public.profiles pr ON pr.id = u.id
  WHERE lower(u.email) = ANY (SELECT digits || '@' || d FROM unnest(domains) AS d)
    AND pr.status <> 'banned'
  ORDER BY u.created_at
  LIMIT 1;
  RETURN found;
END $$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_phone(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- >>> 20261030100000_hide_private_profile_columns.sql
-- ============================================================================
/*
# Pulse backend 18 — keep phone numbers and real names out of the public profiles API

Idempotent. Apply after migration 15. No data is changed or deleted.

`profiles` is readable by everyone (signed out included) so names and photos can be shown. Some databases also have
hand-added columns such as `phone`, `phone_number` or `full_name` on it, which made those values public.
Pulse never reads them (numbers live privately in profile_phones / the account), so this switches profiles to
column-level read access: every column except those private ones stays readable.

Re-run this after adding columns to profiles: new columns only become readable once granted here.
*/
DO $$
DECLARE cols text; c text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name NOT IN ('phone', 'phone_number', 'full_name');
  -- PUBLIC too: a grant to PUBLIC would otherwise keep every column readable
  REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('phone', 'phone_number', 'full_name') LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.profiles FROM PUBLIC, anon, authenticated', c);
  END LOOP;
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO anon, authenticated', cols);
END $$;

NOTIFY pgrst, 'reload schema';
