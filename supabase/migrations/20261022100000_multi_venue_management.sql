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
