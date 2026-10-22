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
