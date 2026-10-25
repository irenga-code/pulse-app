-- Pulse phone lookup smoke test (migration 17).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-17.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_phone_lookup_smoke.sql
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
  me      constant uuid := 'a0000000-0000-0000-0000-0000000000b1';
  mapped  constant uuid := 'a0000000-0000-0000-0000-0000000000b2';
  legacy  constant uuid := 'a0000000-0000-0000-0000-0000000000b3';
  outside constant uuid := 'a0000000-0000-0000-0000-0000000000b4';
  sms     constant uuid := 'a0000000-0000-0000-0000-0000000000b5';
  squat   constant uuid := 'a0000000-0000-0000-0000-0000000000b6';
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (me,      'pl.me@example.com',                  '{"display_name":"pl_me"}'),
    (mapped,  '243962309533@pulse.internal.com',    '{"display_name":"pl_mapped"}'),
    (legacy,  '256700000001@pulse.local',           '{"display_name":"pl_legacy"}'),
    (outside, '256700000002@gmail.com',             '{"display_name":"pl_outside"}');

  PERFORM pulse_test.ok((SELECT value FROM public.app_config WHERE key = 'phone_email_domains') = 'pulse.internal.com,pulse.local', 'mapping domains are configured');

  PERFORM pulse_test.act_as(me);
  PERFORM pulse_test.ok(public.find_user_by_phone('+243 962 309 533') = mapped, 'finds a phone + password account by its number');
  PERFORM pulse_test.ok(public.find_user_by_phone('243962309533') = mapped, 'any formatting');
  PERFORM pulse_test.ok(public.find_user_by_phone('+256700000001') = legacy, 'the older pulse.local domain is found too');
  PERFORM pulse_test.ok(public.find_user_by_phone('+256700000002') IS NULL, 'a real email that happens to be digits is not a phone account');
  PERFORM pulse_test.ok(public.find_user_by_phone('12') IS NULL, 'too short returns nothing');
  PERFORM pulse_test.ok(public.find_user_by_phone('+256 799 999 999') IS NULL, 'unknown numbers return nothing');

  -- an SMS-confirmed owner of the number wins over a mapped account
  PERFORM pulse_test.act_super();
  INSERT INTO auth.users (id, email, phone, phone_confirmed_at, raw_user_meta_data) VALUES
    (sms, NULL, '256788000000', now(), '{"display_name":"pl_sms"}'),
    (squat, '256788000000@pulse.internal.com', NULL, NULL, '{"display_name":"pl_squat"}');
  PERFORM pulse_test.act_as(me);
  PERFORM pulse_test.ok(public.find_user_by_phone('+256788000000') = sms, 'a number confirmed by SMS wins over an unverified one');

  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'banned' WHERE id = mapped;
  PERFORM pulse_test.act_as(me);
  PERFORM pulse_test.ok(public.find_user_by_phone('+243962309533') IS NULL, 'banned accounts cannot be found');

  PERFORM pulse_test.act_super();
  UPDATE public.app_config SET value = 'users.example.com' WHERE key = 'phone_email_domains';
  PERFORM pulse_test.act_as(me);
  PERFORM pulse_test.ok(public.find_user_by_phone('+256700000001') IS NULL, 'only the configured domains count');

  PERFORM pulse_test.act_super();
  SET LOCAL ROLE anon;
  PERFORM pulse_test.fails($q$SELECT public.find_user_by_phone('243962309533')$q$, 'signed-out visitors cannot look numbers up');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(NOT has_table_privilege('authenticated', 'public.app_config', 'SELECT'), 'app_config stays private');
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
