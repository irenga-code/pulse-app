-- Pulse private profile columns smoke test (migration 18).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-18.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_private_profile_columns_smoke.sql
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

-- simulate a database where someone added public phone / name columns, then re-apply migration 18's grants
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text, ADD COLUMN IF NOT EXISTS phone_number text, ADD COLUMN IF NOT EXISTS full_name text;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name NOT IN ('phone', 'phone_number', 'full_name');
  REVOKE SELECT ON public.profiles FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO anon, authenticated', cols);
END $$;

DO $$
DECLARE u constant uuid := 'a0000000-0000-0000-0000-0000000000d1';
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (u, 'pc.u@example.com', '{"display_name":"pc_user"}');
  UPDATE public.profiles SET phone = '+256700000009', phone_number = '256700000009', full_name = 'Real Name' WHERE id = u;

  SET LOCAL ROLE anon;
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id = u) = 'pc_user', 'signed-out visitors still see names');
  PERFORM pulse_test.fails(format('SELECT phone FROM public.profiles WHERE id = %L', u), 'signed-out visitors cannot read profiles.phone');
  PERFORM pulse_test.fails(format('SELECT phone_number FROM public.profiles WHERE id = %L', u), 'signed-out visitors cannot read profiles.phone_number');
  PERFORM pulse_test.fails(format('SELECT full_name FROM public.profiles WHERE id = %L', u), 'signed-out visitors cannot read profiles.full_name');
  PERFORM pulse_test.act_super();

  PERFORM pulse_test.act_as(u);
  PERFORM pulse_test.ok((SELECT bio IS NULL AND account_type = 'user' AND phone_verified IS NOT NULL FROM public.profiles WHERE id = u), 'the columns the app reads are still readable');
  PERFORM pulse_test.fails(format('SELECT phone FROM public.profiles WHERE id = %L', u), 'signed-in users cannot read phone either (even their own)');
  UPDATE public.profiles SET bio = 'still editable' WHERE id = u;
  PERFORM pulse_test.ok((SELECT bio FROM public.profiles WHERE id = u) = 'still editable', 'profile editing still works');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT phone FROM public.profiles WHERE id = u) = '+256700000009', 'nothing was deleted');
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
