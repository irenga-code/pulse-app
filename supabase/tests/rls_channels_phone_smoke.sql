-- Pulse channels, chat snaps and phone numbers smoke test (migration 15).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-15.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_channels_phone_smoke.sql
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
  mgr   constant uuid := 'a0000000-0000-0000-0000-0000000000f1';
  fan   constant uuid := 'a0000000-0000-0000-0000-0000000000f2';
  other constant uuid := 'a0000000-0000-0000-0000-0000000000f3';
  phone_u constant uuid := 'a0000000-0000-0000-0000-0000000000f4';
  nomad uuid; thrones uuid; ch uuid; conv uuid; st uuid; n int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (mgr,   'cp.mgr@example.com',   '{"display_name":"cp_mgr"}'),
    (fan,   'cp.fan@example.com',   '{"display_name":"cp_fan"}'),
    (other, 'cp.other@example.com', '{"display_name":"cp_other"}');
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO thrones FROM public.venues WHERE name = 'Thrones';
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (nomad, mgr, 'host');

  -- ------------------------------------------------- channels
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_channels (venue_id, name) VALUES (%L, 'Nomad Live')$q$, nomad), 'a fan cannot create a venue channel');
  PERFORM pulse_test.act_as(mgr);
  INSERT INTO public.venue_channels (venue_id, name, description) VALUES (nomad, 'Nomad Live', 'Line-ups and drops') RETURNING id INTO ch;
  PERFORM pulse_test.ok((SELECT created_by FROM public.venue_channels WHERE id = ch) = mgr, 'venue staff create the channel (created_by stamped)');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_channels (venue_id, name) VALUES (%L, 'Thrones')$q$, thrones), 'staff cannot create a channel for another venue');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_channels (venue_id, name) VALUES (%L, 'Second')$q$, nomad), 'one channel per venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.venue_channels SET follower_count = 9999 WHERE id = %L$q$, ch), 'follower_count cannot be set by hand');
  INSERT INTO public.channel_messages (channel_id, body) VALUES (ch, 'Doors at 10');
  INSERT INTO public.channel_messages (channel_id, media_url, media_type) VALUES (ch, 'https://x/flyer.jpg', 'image');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.channel_messages WHERE channel_id = ch AND author_id = mgr) = 2, 'staff post text and media to the channel');
  PERFORM pulse_test.ok((SELECT last_message_at IS NOT NULL FROM public.venue_channels WHERE id = ch), 'last_message_at follows new posts');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.channel_messages (channel_id) VALUES (%L)$q$, ch), 'an empty channel post is rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.channel_messages (channel_id, media_url, media_type) VALUES (%L, 'javascript:alert(1)', 'image')$q$, ch), 'channel media must be http(s)');

  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.channel_messages (channel_id, body) VALUES (%L, 'spam')$q$, ch), 'a follower cannot post to the channel');
  INSERT INTO public.channel_followers (channel_id) VALUES (ch);
  PERFORM pulse_test.ok((SELECT follower_count FROM public.venue_channels WHERE id = ch) = 1, 'following counts up');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.channel_followers (channel_id, user_id) VALUES (%L, %L)$q$, ch, other), 'cannot follow on someone else''s behalf');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.channel_messages WHERE channel_id = %L$q$, ch)) = 0, 'a follower cannot delete channel posts');
  PERFORM pulse_test.act_as(other);
  PERFORM pulse_test.ok((SELECT count(*) FROM public.channel_followers) = 0, 'follower lists are private');
  PERFORM pulse_test.act_as(fan);
  DELETE FROM public.channel_followers WHERE channel_id = ch;
  PERFORM pulse_test.ok((SELECT follower_count FROM public.venue_channels WHERE id = ch) = 0, 'unfollowing counts down');

  PERFORM pulse_test.act_super();
  SET LOCAL ROLE anon;
  PERFORM pulse_test.ok((SELECT count(*) FROM public.channel_messages WHERE channel_id = ch) = 2, 'anyone can read a channel');
  PERFORM pulse_test.act_super();

  -- ------------------------------------------------- chat snaps + filters
  PERFORM pulse_test.act_as(fan);
  conv := public.get_or_create_conversation(mgr);
  INSERT INTO public.messages (conversation_id, body, media_url, media_type) VALUES (conv, '📸 Snap', 'https://x/snap.jpg', 'image');
  PERFORM pulse_test.ok((SELECT media_type FROM public.messages WHERE conversation_id = conv) = 'image', 'a photo snap can be sent in a direct chat');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url) VALUES (%L, 'x', 'https://x/a.jpg')$q$, conv), 'media needs its type');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type) VALUES (%L, 'x', 'ftp://x/a.jpg', 'image')$q$, conv), 'chat media must be http(s)');
  UPDATE public.conversation_participants SET is_favorite = true, is_archived = true WHERE conversation_id = conv AND user_id = fan;
  PERFORM pulse_test.ok((SELECT is_favorite AND is_archived FROM public.conversation_participants WHERE conversation_id = conv AND user_id = fan), 'favorite and archive your own chat');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.conversation_participants SET is_archived = true WHERE conversation_id = %L AND user_id = %L$q$, conv, mgr)) = 0, 'cannot archive the chat for the other person');
  PERFORM pulse_test.fails(format($q$UPDATE public.conversation_participants SET last_read_at = now() WHERE conversation_id = %L AND user_id = %L$q$, conv, fan), 'only the filter columns are editable');

  -- ------------------------------------------------- vibe check stories
  PERFORM pulse_test.act_super();  -- the app uploads first; statuses_prepare checks that upload, so insert directly here
  INSERT INTO public.statuses (user_id, media_url, media_type, caption, venue_id) VALUES (fan, 'https://x/s.jpg', 'image', 'Packed!', nomad) RETURNING id INTO st;
  PERFORM pulse_test.act_as(other);
  PERFORM pulse_test.ok((SELECT venue_name FROM public.vibe_check_stories WHERE id = st) = 'Nomad', 'vibe_check_stories carries the venue for the overlay');
  PERFORM pulse_test.act_super();
  UPDATE public.statuses SET expires_at = now() - interval '1 minute' WHERE id = st;
  PERFORM pulse_test.act_as(other);
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.vibe_check_stories WHERE id = st), 'expired stories drop out');

  -- ------------------------------------------------- phone numbers
  PERFORM pulse_test.act_super();
  INSERT INTO auth.users (id, phone, phone_confirmed_at, raw_user_meta_data) VALUES (phone_u, '256700111222', now(), '{"display_name":"cp_phone"}');
  PERFORM pulse_test.ok((SELECT phone_verified FROM public.profiles WHERE id = phone_u), 'a phone sign-up gets a profile with phone_verified');
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id = phone_u) = 'cp_phone', 'and keeps the chosen display name');
  UPDATE auth.users SET phone = '256700333444', phone_confirmed_at = NULL WHERE id = other;
  PERFORM pulse_test.ok(NOT (SELECT phone_verified FROM public.profiles WHERE id = other), 'an unconfirmed number does not count');
  UPDATE auth.users SET phone_confirmed_at = now() WHERE id = other;
  PERFORM pulse_test.ok((SELECT phone_verified FROM public.profiles WHERE id = other), 'confirming the number verifies it');

  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(public.find_user_by_phone('+256 700-111 222') = phone_u, 'find a user by phone (any formatting)');
  PERFORM pulse_test.ok(public.find_user_by_phone('+256 799 999 999') IS NULL, 'unknown numbers return nothing');
  PERFORM pulse_test.ok((SELECT count(*) FROM public.profile_phones) = 0, 'other people''s numbers are private');
  PERFORM pulse_test.act_as(phone_u);
  PERFORM pulse_test.ok((SELECT phone FROM public.profile_phones) = '256700111222', 'you can read your own number');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'banned' WHERE id = phone_u;
  PERFORM pulse_test.act_as(fan);
  PERFORM pulse_test.ok(public.find_user_by_phone('256700111222') IS NULL, 'banned accounts cannot be found');
  PERFORM pulse_test.act_super();
  SET LOCAL ROLE anon;
  PERFORM pulse_test.fails($q$SELECT public.find_user_by_phone('256700111222')$q$, 'signed-out visitors cannot look numbers up');
  PERFORM pulse_test.act_super();
  UPDATE auth.users SET phone = NULL WHERE id = other;
  PERFORM pulse_test.ok(NOT (SELECT phone_verified FROM public.profiles WHERE id = other) AND NOT EXISTS (SELECT 1 FROM public.profile_phones WHERE user_id = other), 'removing the number clears it');

  -- ------------------------------------------------- staff delete / venue delete
  PERFORM pulse_test.act_as(mgr);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.channel_messages WHERE channel_id = %L$q$, ch)) = 2, 'venue staff can delete channel posts');
  PERFORM pulse_test.act_super();
  DELETE FROM public.venues WHERE id = nomad;
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_channels WHERE id = ch), 'deleting a venue deletes its channel');
END $$;

ROLLBACK;
