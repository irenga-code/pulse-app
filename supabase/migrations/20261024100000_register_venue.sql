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
