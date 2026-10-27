-- Pulse chat list actions smoke test (migration 20).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-20.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_chat_list_actions_smoke.sql
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
  a constant uuid := 'a0000000-0000-0000-0000-0000000000c7';
  b constant uuid := 'a0000000-0000-0000-0000-0000000000c8';
  c constant uuid := 'a0000000-0000-0000-0000-0000000000c9';
  d constant uuid := 'a0000000-0000-0000-0000-0000000000ca';
  e constant uuid := 'a0000000-0000-0000-0000-0000000000cb';
  ab uuid; ac uuid; ad uuid; ae uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (a, 'cl.a@example.com', '{"display_name":"cl_a"}'), (b, 'cl.b@example.com', '{"display_name":"cl_b"}'),
    (c, 'cl.c@example.com', '{"display_name":"cl_c"}'), (d, 'cl.d@example.com', '{"display_name":"cl_d"}'),
    (e, 'cl.e@example.com', '{"display_name":"cl_e"}');
  PERFORM pulse_test.act_as(a);
  ab := public.get_or_create_conversation(b); ac := public.get_or_create_conversation(c);
  ad := public.get_or_create_conversation(d); ae := public.get_or_create_conversation(e);

  -- pin (max 3) and mark as unread: your own row only
  UPDATE public.conversation_participants SET is_pinned = true WHERE conversation_id IN (ab, ac, ad) AND user_id = a;
  PERFORM pulse_test.ok((SELECT count(*) FROM public.conversation_participants WHERE user_id = a AND is_pinned AND pinned_at IS NOT NULL) = 3, 'pin up to 3 chats (pinned_at stamped)');
  PERFORM pulse_test.fails(format($q$UPDATE public.conversation_participants SET is_pinned = true WHERE conversation_id = %L AND user_id = %L$q$, ae, a), 'a 4th pinned chat is refused');
  UPDATE public.conversation_participants SET is_pinned = false WHERE conversation_id = ad AND user_id = a;
  PERFORM pulse_test.ok((SELECT pinned_at IS NULL FROM public.conversation_participants WHERE conversation_id = ad AND user_id = a), 'unpin clears pinned_at');
  UPDATE public.conversation_participants SET marked_unread = true WHERE conversation_id = ab AND user_id = a;
  PERFORM pulse_test.ok((SELECT marked_unread FROM public.conversation_participants WHERE conversation_id = ab AND user_id = a), 'mark as unread');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.conversation_participants SET is_pinned = true WHERE conversation_id = %L AND user_id = %L$q$, ab, b)) = 0, 'cannot pin the chat for the other person');

  -- block: no messages either way, only the blocker sees it
  INSERT INTO public.messages (conversation_id, body) VALUES (ab, 'before the block');
  INSERT INTO public.user_blocks (blocked_id) VALUES (b);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'hi')$q$, ab), 'you cannot message someone you blocked');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'hello?')$q$, ab), 'the blocked person cannot message you');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.user_blocks) = 0, 'the blocked person cannot see the block');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.messages WHERE conversation_id = ab) = 1, 'earlier messages stay');
  PERFORM pulse_test.act_as(a);
  INSERT INTO public.messages (conversation_id, body) VALUES (ac, 'other chats still work');
  PERFORM pulse_test.ok(true, 'other chats are not affected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.user_blocks (blocked_id) VALUES (%L)$q$, a), 'you cannot block yourself');
  DELETE FROM public.user_blocks WHERE blocked_id = b;
  INSERT INTO public.messages (conversation_id, body) VALUES (ab, 'unblocked');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.messages WHERE conversation_id = ab) = 2, 'unblock: messages flow again');
  PERFORM pulse_test.act_super();
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
