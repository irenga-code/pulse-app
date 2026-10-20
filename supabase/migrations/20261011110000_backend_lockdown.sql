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
