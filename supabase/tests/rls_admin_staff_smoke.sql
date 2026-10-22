-- Pulse admin venue-staff smoke test (migration 10): find users, link/unlink managers and hosts.
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-10.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_admin_staff_smoke.sql
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
  PERFORM set_config('request.jwt.claims', '{}', true);
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

DO $$
DECLARE
  staff constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  fan   constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  adm   constant uuid := 'a0000000-0000-0000-0000-0000000000b3';
  nomad uuid; thrones uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (staff, 'Staff.Person@example.com', '{"display_name":"dj_staffer"}'),
    (fan,   'st.fan@example.com',       '{"display_name":"st_fan"}'),
    (adm,   'st.adm@example.com',       '{"display_name":"st_adm"}');
  INSERT INTO public.admins (user_id) VALUES (adm);
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO thrones FROM public.venues WHERE name = 'Thrones';

  -- ------------------------------------------------- finding users
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok((SELECT id FROM public.admin_find_users('staff.person@EXAMPLE.com') WHERE matched_email) = staff,
    'admin finds a user by exact email (case-insensitive)');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.admin_find_users('example.com')) = 0, 'partial email does not match');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.admin_find_users('STAFFER') WHERE id = staff AND NOT matched_email),
    'admin finds a user by partial display name');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.admin_find_users('%')) = 0, 'wildcards are matched literally');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a
    WHERE p.proname = 'admin_find_users' AND a ILIKE '%email%' AND a <> 'matched_email'),
    'admin_find_users never returns an email');
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails($q$SELECT * FROM public.admin_find_users('staff.person@example.com')$q$, 'non-admin cannot look users up');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails($q$SELECT * FROM public.admin_find_users('staffer')$q$, 'anon cannot look users up');

  -- ------------------------------------------------- assigning
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_assign_venue_staff(staff, nomad, 'manager');
  PERFORM public.admin_assign_venue_staff(staff, thrones, 'host');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venue_managers WHERE user_id = staff) = 2, 'admin links one user to two venues');
  PERFORM public.admin_assign_venue_staff(staff, nomad, 'host');
  PERFORM pulse_test.ok((SELECT role FROM public.venue_managers WHERE user_id = staff AND venue_id = nomad) = 'host',
    're-assigning changes the role instead of duplicating');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.moderation_log WHERE action = 'assign_venue_staff' AND target_id = staff) = 3,
    'assignments are logged');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_assign_venue_staff(%L, %L, 'owner')$q$, fan, nomad), 'owner role is not assignable here');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_assign_venue_staff(%L, %L, 'manager')$q$, gen_random_uuid(), nomad), 'unknown user rejected');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_assign_venue_staff(%L, %L, 'manager')$q$, fan, gen_random_uuid()), 'unknown venue rejected');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venue_managers WHERE user_id = staff) = 2, 'admin sees every assignment');

  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails(format($q$SELECT public.admin_assign_venue_staff(%L, %L, 'manager')$q$, fan, nomad), 'non-admin cannot assign');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_unassign_venue_staff(%L, %L)$q$, staff, nomad), 'non-admin cannot unlink');
  PERFORM pulse_test.act_as(staff);
  PERFORM pulse_test.ok(public.manages_venue(nomad) AND public.manages_venue(thrones), 'linked user now manages both venues');

  -- ------------------------------------------------- unlinking
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_unassign_venue_staff(staff, thrones);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_managers WHERE user_id = staff AND venue_id = thrones), 'admin unlinks a venue');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.moderation_log WHERE action = 'unassign_venue_staff' AND target_id = staff AND note = 'host of Thrones'),
    'unlinking is logged');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_unassign_venue_staff(%L, %L)$q$, staff, thrones), 'unlinking twice reports not found');
  PERFORM pulse_test.act_as(staff);
  PERFORM pulse_test.ok(NOT public.manages_venue(thrones) AND public.manages_venue(nomad), 'unlinked user loses only that venue');

  PERFORM pulse_test.act_super();
  RAISE NOTICE '== ALL CHECKS PASSED ==';
END $$;

ROLLBACK;
