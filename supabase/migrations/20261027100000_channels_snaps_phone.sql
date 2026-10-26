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
