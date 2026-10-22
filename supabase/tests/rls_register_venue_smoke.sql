-- Pulse self-service venue registration smoke test (migration 12): register_venue().
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-12.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_register_venue_smoke.sql
BEGIN;

CREATE SCHEMA pulse_test;
GRANT USAGE ON SCHEMA pulse_test TO PUBLIC;
CREATE FUNCTION pulse_test.act_as(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION pulse_test.act_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
END $$;
CREATE FUNCTION pulse_test.act_super() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE FUNCTION pulse_test.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok - %', label;
END $$;
CREATE FUNCTION pulse_test.fails(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok - blocked: % (%)', label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected an error but it succeeded: %', label;
END $$;
CREATE FUNCTION pulse_test.rows(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int;
BEGIN EXECUTE stmt; GET DIAGNOSTICS c = ROW_COUNT; RETURN c; END $$;

DO $$
DECLARE
  owner  constant uuid := 'a0000000-0000-0000-0000-0000000000c1';
  fan    constant uuid := 'a0000000-0000-0000-0000-0000000000c2';
  banned constant uuid := 'a0000000-0000-0000-0000-0000000000c3';
  v public.venues;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (owner,  'reg.owner@example.com',  '{"display_name":"reg_owner"}'),
    (fan,    'reg.fan@example.com',    '{"display_name":"reg_fan"}'),
    (banned, 'reg.banned@example.com', '{"display_name":"reg_banned"}');
  UPDATE public.profiles SET status = 'banned' WHERE id = banned;

  PERFORM pulse_test.act_as(owner);
  v := public.register_venue('  Sky Lounge  ', 'Kololo', 'Rooftop cocktails', 'https://cdn.example.com/c.jpg', 'https://cdn.example.com/l.png');
  PERFORM pulse_test.ok(v.name = 'Sky Lounge' AND v.location = 'Kololo' AND v.description = 'Rooftop cocktails', 'registers with trimmed name, location and description');
  PERFORM pulse_test.ok(v.image_url = 'https://cdn.example.com/c.jpg' AND v.logo_url = 'https://cdn.example.com/l.png', 'stores cover and logo');
  PERFORM pulse_test.ok(v.is_verified = false AND v.status = 'not_active', 'starts unverified and Not active');
  PERFORM pulse_test.ok(v.created_by = owner AND v.slug = 'sky-lounge', 'records creator and slug');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.venue_managers WHERE venue_id = v.id AND user_id = owner AND role = 'manager'),
    'creator is linked as manager');
  PERFORM pulse_test.ok(public.manages_venue(v.id), 'creator manages the venue right away');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'Edited' WHERE id = %L$q$, v.id)) = 1,
    'creator edits the profile without an admin');
  PERFORM pulse_test.ok((public.set_venue_status(v.id, 'live', 60)).status = 'live', 'creator sets the live status');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venues_public WHERE id = v.id) = 1, 'new venue is listed publicly');

  PERFORM pulse_test.fails($q$SELECT public.register_venue('sky lounge', 'KOLOLO')$q$, 'duplicate name in the same location');
  PERFORM pulse_test.ok((public.register_venue('Sky Lounge', 'Ntinda')).slug = 'sky-lounge-2', 'same name elsewhere gets its own slug');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('X', 'Kololo')$q$, 'name too short');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Club Y', '')$q$, 'location required');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Club Z', 'Kololo', repeat('a', 501))$q$, 'description too long');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Club J', 'Kololo', NULL, 'javascript:alert(1)')$q$, 'cover must be http(s)');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Club K', 'Kololo', NULL, NULL, 'data:image/png;base64,AAAA')$q$, 'logo must be http(s)');
  PERFORM public.register_venue('Third Club', 'Bugolobi');
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Fourth Club', 'Bugolobi')$q$, 'at most 3 registrations per day');
  PERFORM pulse_test.fails($q$INSERT INTO public.venues (name, location) VALUES ('Direct', 'Kololo')$q$, 'no direct inserts into venues');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id, role) SELECT id, %L, 'manager' FROM public.venues WHERE name = 'Nomad'$q$, owner),
    'cannot link yourself to an existing venue');

  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'hijack' WHERE id = %L$q$, v.id)) = 0,
    'another user cannot edit the new venue');

  PERFORM pulse_test.act_as(banned);
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Banned Club', 'Kololo')$q$, 'inactive account cannot register');

  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails($q$SELECT public.register_venue('Anon Club', 'Kololo')$q$, 'anon cannot register');
  PERFORM pulse_test.act_super();
END $$;

ROLLBACK;
