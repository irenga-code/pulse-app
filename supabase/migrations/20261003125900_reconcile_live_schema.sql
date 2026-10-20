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
