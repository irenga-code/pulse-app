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
