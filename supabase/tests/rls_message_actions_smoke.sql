-- Pulse message actions smoke test (migration 19).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-19.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_message_actions_smoke.sql
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
  a   constant uuid := 'a0000000-0000-0000-0000-0000000000f7';
  b   constant uuid := 'a0000000-0000-0000-0000-0000000000f8';
  eve constant uuid := 'a0000000-0000-0000-0000-0000000000f9';
  conv uuid; other_conv uuid; m1 uuid; m2 uuid; r uuid; n int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (a, 'ma.a@example.com', '{"display_name":"ma_a"}'), (b, 'ma.b@example.com', '{"display_name":"ma_b"}'), (eve, 'ma.e@example.com', '{"display_name":"ma_eve"}');
  PERFORM pulse_test.act_as(a);
  conv := public.get_or_create_conversation(b);
  other_conv := public.get_or_create_conversation(eve);
  INSERT INTO public.messages (conversation_id, body) VALUES (conv, 'hello') RETURNING id INTO m1;

  -- replies + forwarded
  PERFORM pulse_test.act_as(b);
  INSERT INTO public.messages (conversation_id, body, reply_to_id) VALUES (conv, 'hi back', m1) RETURNING id INTO m2;
  PERFORM pulse_test.ok((SELECT reply_to_id FROM public.messages WHERE id = m2) = m1, 'reply to a message in the same chat');
  PERFORM pulse_test.act_as(a);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, reply_to_id) VALUES (%L, 'x', %L)$q$, other_conv, m1), 'cannot reply to a message of another chat');
  INSERT INTO public.messages (conversation_id, body, is_forwarded) VALUES (other_conv, 'hello', true);
  PERFORM pulse_test.ok((SELECT is_forwarded FROM public.messages WHERE conversation_id = other_conv ORDER BY created_at DESC LIMIT 1), 'forwarded messages are marked');

  -- reactions
  INSERT INTO public.message_reactions (message_id, emoji) VALUES (m2, '👍');
  PERFORM pulse_test.ok((SELECT user_id FROM public.message_reactions WHERE message_id = m2) = a, 'react to a message');
  UPDATE public.message_reactions SET emoji = '❤️' WHERE message_id = m2 AND user_id = a;
  PERFORM pulse_test.ok((SELECT emoji FROM public.message_reactions WHERE message_id = m2) = '❤️', 'change your reaction');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.message_reactions (message_id, emoji) VALUES (%L, '😂')$q$, m2), 'one reaction per person per message');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.message_reactions WHERE message_id = m2) = 1, 'the other person sees the reaction');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.message_reactions SET emoji = '😢' WHERE message_id = %L AND user_id = %L$q$, m2, a)) = 0, 'cannot change someone else''s reaction');
  PERFORM pulse_test.act_as(eve);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.message_reactions WHERE message_id = m2) = 0, 'outsiders cannot see reactions');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.message_reactions (message_id, emoji) VALUES (%L, '😮')$q$, m2), 'outsiders cannot react');

  -- stars + delete for me
  PERFORM pulse_test.act_as(a);
  INSERT INTO public.message_stars (message_id) VALUES (m2);
  INSERT INTO public.message_hidden (message_id) VALUES (m1);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.message_stars) = 1 AND (SELECT count(*) FROM public.message_hidden) = 1, 'star and hide for yourself');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.message_stars) = 0 AND (SELECT count(*) FROM public.message_hidden) = 0, 'stars and hidden messages are private');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.messages WHERE id = m1), 'delete for me does not delete it for the other person');
  PERFORM pulse_test.act_as(eve);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.message_stars (message_id) VALUES (%L)$q$, m2), 'outsiders cannot star a message they cannot see');

  -- pin
  PERFORM pulse_test.act_as(b);
  PERFORM public.set_pinned_message(conv, m1);
  PERFORM pulse_test.ok((SELECT pinned_message_id FROM public.conversations WHERE id = conv) = m1, 'either person pins a message');
  PERFORM pulse_test.act_as(eve);
  PERFORM pulse_test.fails(format($q$SELECT public.set_pinned_message(%L, NULL)$q$, conv), 'outsiders cannot pin');
  PERFORM pulse_test.act_as(a);
  PERFORM pulse_test.fails(format($q$SELECT public.set_pinned_message(%L, %L)$q$, other_conv, m1), 'can only pin a message of that chat');
  PERFORM public.set_pinned_message(conv, NULL);
  PERFORM pulse_test.ok((SELECT pinned_message_id FROM public.conversations WHERE id = conv) IS NULL, 'unpin');

  -- delete for everyone (own only) cascades reactions
  PERFORM pulse_test.act_as(a);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.messages WHERE id = %L$q$, m2)) = 0, 'cannot delete the other person''s message for everyone');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.messages WHERE id = %L$q$, m2)) = 1, 'delete your own message for everyone');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.message_reactions WHERE message_id = m2), 'its reactions go with it');

  -- report a message: admins see the text and the sender
  PERFORM pulse_test.act_as(a);
  INSERT INTO public.reports (target_type, target_id, reason) VALUES ('message', m1, 'spam') RETURNING id INTO r;
  PERFORM pulse_test.act_super();
  INSERT INTO public.admins (user_id) VALUES (eve) ON CONFLICT DO NOTHING;
  PERFORM pulse_test.act_as(eve);
  PERFORM pulse_test.ok((SELECT target_preview = 'hello' AND target_user_id = a FROM public.admin_report_queue WHERE id = r), 'admins see the reported message and its sender');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.admin_report_queue), 'non-admins see no report queue');
  PERFORM pulse_test.act_super();
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
