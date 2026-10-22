-- Pulse multi-venue management smoke test (migration 9): hosts/managers linked to several venues.
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-9.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_multi_venue_smoke.sql
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
  host  constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  fan   constant uuid := 'a0000000-0000-0000-0000-0000000000a2';
  adm   constant uuid := 'a0000000-0000-0000-0000-0000000000a3';
  nomad uuid; thrones uuid; other uuid; p uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (host, 'mv.host@example.com', '{"display_name":"mv_host"}'),
    (fan,  'mv.fan@example.com',  '{"display_name":"mv_fan"}'),
    (adm,  'mv.adm@example.com',  '{"display_name":"mv_adm"}');
  INSERT INTO public.admins (user_id) VALUES (adm);
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO thrones FROM public.venues WHERE name = 'Thrones';
  SELECT id INTO other FROM public.venues WHERE id NOT IN (nomad, thrones) LIMIT 1;
  UPDATE public.venues SET is_verified = true WHERE id = nomad;
  UPDATE public.venues SET is_verified = false WHERE id = thrones;

  -- ------------------------------------------------- assignments
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (nomad, host, 'host'), (thrones, host, 'manager');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venue_managers WHERE user_id = host) = 2, 'one user can be linked to several venues');
  PERFORM pulse_test.fails($q$INSERT INTO public.venue_managers (venue_id, user_id, role)
    SELECT id, 'a0000000-0000-0000-0000-0000000000a2', 'janitor' FROM public.venues LIMIT 1$q$, 'unknown role rejected');

  PERFORM pulse_test.act_as(host);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venue_managers) = 2, 'linked user sees only their own assignments');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_managers (venue_id, user_id) VALUES (%L, %L)$q$, other, host),
    'linked user cannot assign themselves another venue');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (%L, %L, 'host')$q$, other, fan)) = 1,
    'admin can link a host to a venue');
  DELETE FROM public.venue_managers WHERE venue_id = other AND user_id = fan;

  -- ------------------------------------------------- venue profiles
  PERFORM pulse_test.act_as(host);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'Rooftop nights', image_url = 'https://cdn.example.com/n.jpg',
    phone = '+256700000000' WHERE id = %L$q$, nomad)) = 1, 'host edits the first linked venue profile');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'Afrobeats Fridays' WHERE id = %L$q$, thrones)) = 1,
    'host edits the second linked venue profile');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'hijack' WHERE id = %L$q$, other)) = 0,
    'host cannot edit an unlinked venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET name = 'Renamed' WHERE id = %L$q$, nomad), 'host cannot rename a venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET is_verified = true WHERE id = %L$q$, thrones), 'host cannot verify a venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET image_url = 'javascript:alert(1)' WHERE id = %L$q$, nomad), 'image must be http(s)');
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'x' WHERE id = %L$q$, nomad)) = 0,
    'regular user cannot edit a venue');

  -- ------------------------------------------------- posting as a venue
  PERFORM pulse_test.act_as(host);
  INSERT INTO public.posts (content, venue_id, as_venue) VALUES ('Doors open 9pm', nomad, true) RETURNING id INTO p;
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT user_name = 'Nomad' AND user_id = host AND as_venue AND is_official FROM public.posts WHERE id = p),
    'post as verified venue: venue name as author, real author kept, official');
  PERFORM pulse_test.act_as(host);
  INSERT INTO public.posts (content, venue_id, as_venue) VALUES ('Ladies night', thrones, true) RETURNING id INTO p;
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT user_name = 'Thrones' AND as_venue AND NOT is_official FROM public.posts WHERE id = p),
    'post as unverified venue: venue name, no official badge');
  PERFORM pulse_test.act_as(host);
  INSERT INTO public.posts (content, venue_id) VALUES ('personal take', nomad) RETURNING id INTO p;
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT user_name = 'mv_host' AND NOT as_venue FROM public.posts WHERE id = p), 'without as_venue the post stays personal');

  PERFORM pulse_test.act_as(host);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, venue_id, as_venue) VALUES ('fake', %L, true)$q$, other),
    'cannot post as an unlinked venue');
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, as_venue) VALUES ('no venue', true)$q$, 'as_venue needs a venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.posts SET as_venue = true WHERE id = %L$q$, p), 'as_venue cannot be switched on later');
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, venue_id, as_venue) VALUES ('fake', %L, true)$q$, nomad),
    'regular user cannot post as a venue');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, venue_id, as_venue) VALUES ('admin', %L, true)$q$, nomad),
    'admins are not implicitly every venue');

  PERFORM pulse_test.act_super();
  RAISE NOTICE '== ALL CHECKS PASSED ==';
END $$;

ROLLBACK;
