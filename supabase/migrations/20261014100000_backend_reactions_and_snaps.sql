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
