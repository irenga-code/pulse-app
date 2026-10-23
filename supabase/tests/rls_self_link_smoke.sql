-- Pulse self-link to venues smoke test (migration 14).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-14.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_self_link_smoke.sql
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
  host_u  constant uuid := 'a0000000-0000-0000-0000-0000000000e1';
  venue_u constant uuid := 'a0000000-0000-0000-0000-0000000000e2';
  fan     constant uuid := 'a0000000-0000-0000-0000-0000000000e3';
  gone    constant uuid := 'a0000000-0000-0000-0000-0000000000e4';
  nomad uuid; paradigm uuid; extra int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (host_u,  'sl.host@example.com',  '{"display_name":"sl_host"}'),
    (venue_u, 'sl.venue@example.com', '{"display_name":"sl_venue"}'),
    (fan,     'sl.fan@example.com',   '{"display_name":"sl_fan"}'),
    (gone,    'sl.gone@example.com',  '{"display_name":"sl_gone"}');
  UPDATE public.profiles SET account_type = 'host' WHERE id IN (host_u, gone);
  UPDATE public.profiles SET account_type = 'venue' WHERE id = venue_u;
  UPDATE public.profiles SET status = 'suspended' WHERE id = gone;
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO paradigm FROM public.venues WHERE name = 'Paradigm';
  -- more venues than any small cap would allow
  INSERT INTO public.venues (name, location) SELECT 'SL Club ' || g, 'Kampala' FROM generate_series(1, 25) g;

  -- ------------------------------------------------- host account
  PERFORM pulse_test.act_as(host_u);
  INSERT INTO public.venue_managers (venue_id, user_id) VALUES (nomad, host_u);
  PERFORM pulse_test.ok((SELECT role FROM public.venue_managers WHERE venue_id = nomad AND user_id = host_u) = 'manager', 'host links themselves (role defaults to manager)');
  PERFORM pulse_test.ok(public.manages_venue(nomad), 'and now manages the venue');
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (paradigm, host_u, 'host');
  PERFORM pulse_test.ok((SELECT role FROM public.venue_managers WHERE venue_id = paradigm AND user_id = host_u) = 'host', 'host can link with the host role');
  INSERT INTO public.venue_managers (venue_id, user_id) SELECT id, host_u FROM public.venues WHERE name LIKE 'SL Club %';
  GET DIAGNOSTICS extra = ROW_COUNT;
  PERFORM pulse_test.ok(extra = 25 AND (SELECT count(*) FROM public.venue_managers WHERE user_id = host_u) = 27, 'no cap: links 27 venues');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, nomad, host_u), 'cannot link the same venue twice');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (%L, %L, 'owner')$q$, (SELECT id FROM public.venues WHERE name = 'Thrones'), host_u), 'cannot make themselves owner');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, nomad, fan), 'cannot link someone else');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venue_managers SET role = 'owner' WHERE user_id = %L$q$, host_u)) = 0, 'cannot promote their own link');
  PERFORM public.leave_venue(paradigm);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_managers WHERE venue_id = paradigm AND user_id = host_u), 'can still leave with leave_venue');

  -- ------------------------------------------------- venue account
  PERFORM pulse_test.act_as(venue_u);
  INSERT INTO public.venue_managers (venue_id, user_id) VALUES (nomad, venue_u);
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.venue_managers WHERE venue_id = nomad AND user_id = venue_u), 'venue account links itself');

  -- ------------------------------------------------- not allowed
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, nomad, fan), 'plain user cannot link themselves');
  PERFORM pulse_test.act_as(gone);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, nomad, gone), 'suspended host cannot link themselves');
  PERFORM pulse_test.act_as(host_u);
  PERFORM public.relinquish_my_role();
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, paradigm, host_u), 'after dropping the Host role they cannot link more');
  PERFORM pulse_test.act_super();
END $$;

ROLLBACK;
