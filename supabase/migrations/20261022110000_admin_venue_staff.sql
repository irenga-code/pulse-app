/*
# Pulse backend 10 — admin: link users to venues as Manager or Host

Idempotent and additive. Apply after migration 9.

- `admin_find_users(q)`: admins look a user up by display name (partial match) or by email (exact match,
  case-insensitive). The email is only compared, never returned, so it stays out of every API response.
- `admin_assign_venue_staff(user, venue, role)`: links a user to a venue as 'manager' or 'host' (re-assigning
  changes the role). 'owner' stays reserved for approved venue verification requests.
- `admin_unassign_venue_staff(user, venue)`: removes the link.
Both write to `moderation_log`. Reading the assignment list uses the existing `vm_select` policy (admins see all rows).
*/

CREATE OR REPLACE FUNCTION public.admin_find_users(p_query text)
RETURNS TABLE (id uuid, display_name text, avatar_url text, account_type text, is_verified boolean, status text, matched_email boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q text := btrim(coalesce(p_query, ''));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF char_length(q) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, p.account_type::text, p.is_verified, p.status::text,
           lower(u.email) = lower(q) AS matched_email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE lower(u.email) = lower(q)
       OR p.display_name ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    ORDER BY (lower(u.email) = lower(q)) DESC, p.display_name
    LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_venue_staff(p_user_id uuid, p_venue_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  vname text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('manager', 'host') THEN RAISE EXCEPTION 'role must be manager or host' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT name INTO vname FROM public.venues WHERE id = p_venue_id;
  IF vname IS NULL THEN RAISE EXCEPTION 'venue not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (p_venue_id, p_user_id, p_role)
  ON CONFLICT (venue_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  PERFORM public.log_admin_action('assign_venue_staff', 'user', p_user_id, p_role || ' of ' || vname);
END $$;

CREATE OR REPLACE FUNCTION public.admin_unassign_venue_staff(p_user_id uuid, p_venue_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  removed text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admins only' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.venue_managers WHERE venue_id = p_venue_id AND user_id = p_user_id RETURNING role INTO removed;
  IF removed IS NULL THEN RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.log_admin_action('unassign_venue_staff', 'user', p_user_id,
    removed || ' of ' || (SELECT name FROM public.venues WHERE id = p_venue_id));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_find_users(text), public.admin_assign_venue_staff(uuid, uuid, text),
  public.admin_unassign_venue_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_users(text), public.admin_assign_venue_staff(uuid, uuid, text),
  public.admin_unassign_venue_staff(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
