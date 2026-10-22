-- Pulse self-service controls smoke test (migration 13).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-13.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_self_service_smoke.sql
BEGIN;

CREATE SCHEMA pulse_test;
GRANT USAGE ON SCHEMA pulse_test TO PUBLIC;
CREATE FUNCTION pulse_test.act_as(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
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
  creator constant uuid := 'a0000000-0000-0000-0000-0000000000d1';
  staff   constant uuid := 'a0000000-0000-0000-0000-0000000000d2';
  fan     constant uuid := 'a0000000-0000-0000-0000-0000000000d3';
  adm     constant uuid := 'a0000000-0000-0000-0000-0000000000d4';
  mine uuid; other uuid; nomad uuid; p uuid; c uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (creator, 'ss.creator@example.com', '{"display_name":"ss_creator"}'),
    (staff,   'ss.staff@example.com',   '{"display_name":"ss_staff"}'),
    (fan,     'ss.fan@example.com',     '{"display_name":"ss_fan"}'),
    (adm,     'ss.adm@example.com',     '{"display_name":"ss_adm"}');
  INSERT INTO public.admins (user_id) VALUES (adm);
  UPDATE public.profiles SET account_type = 'host', is_verified = true WHERE id = staff;
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';

  -- ------------------------------------------------- roles
  PERFORM pulse_test.act_as(staff);
  PERFORM pulse_test.ok((public.relinquish_my_role()).account_type = 'user', 'user drops their Host role');
  PERFORM pulse_test.ok((SELECT NOT is_verified FROM public.profiles WHERE id = staff), 'and loses the badge');
  PERFORM pulse_test.fails(format($q$UPDATE public.profiles SET account_type = 'host' WHERE id = %L$q$, staff), 'cannot give themselves a role back');

  -- ------------------------------------------------- venues: creator
  PERFORM pulse_test.act_as(creator);
  mine := (public.register_venue('Moon Club', 'Kololo')).id;
  other := (public.register_venue('Star Club', 'Ntinda')).id;
  PERFORM pulse_test.ok((SELECT created_by FROM public.venues_public WHERE id = mine) = creator, 'venues_public exposes created_by');
  PERFORM pulse_test.ok((public.rename_my_venue(mine, 'Moon Lounge', 'Kololo, Kampala')).name = 'Moon Lounge', 'creator renames their venue');
  PERFORM pulse_test.fails(format($q$SELECT public.rename_my_venue(%L, 'Star Club', 'Ntinda')$q$, mine), 'rename cannot duplicate another venue');
  PERFORM pulse_test.fails(format($q$SELECT public.rename_my_venue(%L, 'Taken', 'Kampala')$q$, nomad), 'creator cannot rename a venue they did not register');
  PERFORM pulse_test.fails(format($q$SELECT public.delete_my_venue(%L)$q$, nomad), 'creator cannot delete a venue they did not register');

  PERFORM pulse_test.act_super();
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (mine, staff, 'manager');
  INSERT INTO public.venue_follows (venue_id, user_id) VALUES (mine, fan);
  INSERT INTO public.posts (content, venue_id, user_id, user_name) VALUES ('At Moon tonight', mine, fan, 'ss_fan') RETURNING id INTO p;

  -- ------------------------------------------------- venues: linked manager
  PERFORM pulse_test.act_as(staff);
  PERFORM pulse_test.fails(format($q$SELECT public.rename_my_venue(%L, 'Hijack', 'Kololo')$q$, mine), 'linked manager cannot rename');
  PERFORM pulse_test.fails(format($q$SELECT public.delete_my_venue(%L)$q$, mine), 'linked manager cannot delete');
  PERFORM public.leave_venue(mine);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_managers WHERE venue_id = mine AND user_id = staff), 'manager leaves the venue');
  PERFORM pulse_test.fails(format($q$SELECT public.leave_venue(%L)$q$, mine), 'cannot leave a venue twice');

  PERFORM pulse_test.act_as(creator);
  PERFORM public.delete_my_venue(mine);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venues WHERE id = mine), 'creator deletes their venue');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_follows WHERE venue_id = mine), 'its follows go with it');
  PERFORM pulse_test.ok((SELECT venue_id IS NULL FROM public.posts WHERE id = p), 'posts stay, without the venue tag');

  -- ------------------------------------------------- posts and comments: owners edit, others cannot
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.posts SET content = 'Edited' WHERE id = %L$q$, p)) = 1, 'author edits their post');
  INSERT INTO public.comments (post_id, body) VALUES (p, 'first') RETURNING id INTO c;
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.comments SET body = 'edited' WHERE id = %L$q$, c)) = 1, 'author edits their comment');
  PERFORM pulse_test.act_as(creator);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.posts SET content = 'hijack' WHERE id = %L$q$, p)) = 0, 'others cannot edit the post');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.comments SET body = 'hijack' WHERE id = %L$q$, c)) = 0, 'others cannot edit the comment');

  -- ------------------------------------------------- admin overrides
  PERFORM pulse_test.fails(format($q$SELECT public.admin_delete_venue(%L)$q$, other), 'non-admin cannot use admin_delete_venue');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_set_user_role(%L, 'venue', true)$q$, creator), 'non-admin cannot set roles');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok((public.admin_set_user_role(staff, 'venue', true)).account_type = 'venue', 'admin assigns a role and badge');
  PERFORM pulse_test.ok((public.admin_set_user_role(staff, 'user', false)).is_verified = false, 'admin removes a role');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_set_user_role(%L, 'janitor', false)$q$, staff), 'unknown role rejected');
  PERFORM public.admin_delete_venue(other, 'Duplicate listing');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venues WHERE id = other), 'admin deletes any venue');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = creator AND title = 'Star Club was removed from Pulse'
    AND body = 'Duplicate listing'), 'the creator is told why');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.moderation_log WHERE action IN ('delete_venue', 'set_user_role')) >= 3, 'admin actions are logged');
END $$;

ROLLBACK;
