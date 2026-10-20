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
