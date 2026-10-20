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
