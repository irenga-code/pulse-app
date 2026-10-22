-- Pulse venue logo smoke test (migration 11): venues.logo_url.
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-11.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_venue_logo_smoke.sql
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
-- true when the statement errors (no privilege) or touches no rows (RLS)
CREATE FUNCTION pulse_test.denied(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE c int;
BEGIN
  EXECUTE stmt; GET DIAGNOSTICS c = ROW_COUNT; RETURN c = 0;
EXCEPTION WHEN OTHERS THEN RETURN true;
END $$;

DO $$
DECLARE
  mgr   constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  fan   constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  adm   constant uuid := 'a0000000-0000-0000-0000-0000000000b3';
  nomad uuid; other uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr, 'logo.mgr@example.com', '{"display_name":"logo_mgr"}'),
    (fan, 'logo.fan@example.com', '{"display_name":"logo_fan"}'),
    (adm, 'logo.adm@example.com', '{"display_name":"logo_adm"}');
  INSERT INTO public.admins (user_id) VALUES (adm);
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO other FROM public.venues WHERE id <> nomad LIMIT 1;
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (nomad, mgr, 'manager');

  PERFORM pulse_test.ok((SELECT attname FROM pg_attribute WHERE attrelid = 'public.venues_public'::regclass AND attnum > 0
                         ORDER BY attnum DESC LIMIT 1) = 'logo_url', 'venues_public exposes logo_url as its last column');

  PERFORM pulse_test.act_as(mgr);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET logo_url = 'https://cdn.example.com/logo.png' WHERE id = %L$q$, nomad)) = 1,
    'linked manager sets the logo');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET logo_url = 'https://cdn.example.com/x.png' WHERE id = %L$q$, other)) = 0,
    'linked manager cannot set an unlinked venue''s logo');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET logo_url = 'javascript:alert(1)' WHERE id = %L$q$, nomad), 'logo must be http(s)');

  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET logo_url = 'https://cdn.example.com/x.png' WHERE id = %L$q$, nomad)) = 0,
    'unlinked user cannot set a logo');

  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET logo_url = 'https://cdn.example.com/a.png', image_url = 'https://cdn.example.com/c.jpg',
    description = 'Set by admin' WHERE id = %L$q$, other)) = 1, 'admin edits any venue''s logo, cover and profile');

  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok((SELECT logo_url FROM public.venues_public WHERE id = nomad) = 'https://cdn.example.com/logo.png',
    'everyone reads the logo from venues_public');
  PERFORM pulse_test.ok(pulse_test.denied(format($q$UPDATE public.venues SET logo_url = NULL WHERE id = %L$q$, nomad)),
    'anon cannot clear a logo');
END $$;

ROLLBACK;
