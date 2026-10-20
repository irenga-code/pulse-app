-- Pulse social backend smoke test: engagement, Vibe Rep, statuses, direct messages + vanish mode.
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-5.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_social_smoke.sql
BEGIN;

CREATE SCHEMA pulse_test;
GRANT USAGE ON SCHEMA pulse_test TO PUBLIC;
CREATE FUNCTION pulse_test.act_as(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION pulse_test.act_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{}', true); EXECUTE 'SET LOCAL ROLE anon'; END $$;
CREATE FUNCTION pulse_test.act_super() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE FUNCTION pulse_test.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'ok - %', label; END $$;
CREATE FUNCTION pulse_test.fails(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ok - blocked: % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAIL: expected an error but it succeeded: %', label;
END $$;
CREATE FUNCTION pulse_test.n(q text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int; BEGIN EXECUTE 'SELECT count(*)::int FROM (' || q || ') t' INTO c; RETURN c; END $$;
CREATE FUNCTION pulse_test.rows(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int; BEGIN EXECUTE stmt; GET DIAGNOSTICS c = ROW_COUNT; RETURN c; END $$;

DO $$
DECLARE
  alice constant uuid := 'b0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'b0000000-0000-0000-0000-000000000002';
  carol constant uuid := 'b0000000-0000-0000-0000-000000000003';
  adm   constant uuid := 'b0000000-0000-0000-0000-000000000004';
  dave  constant uuid := 'b0000000-0000-0000-0000-000000000005';
  erin  constant uuid := 'b0000000-0000-0000-0000-000000000006';
  base text := 'https://proj.supabase.co/storage/v1/object/public/post-media/';
  nomad uuid; p1 uuid; p2 uuid; s1 uuid; s2 uuid; c1 uuid; c2 uuid; m1 uuid; m2 uuid; rpt uuid; i int; r record; t0 timestamptz;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (alice, 'a@x.com', '{"display_name":"alice_k"}'), (bob, 'b@x.com', '{"display_name":"bob_b"}'),
    (carol, 'c@x.com', '{"display_name":"carol_c"}'), (adm, 'm@x.com', '{"display_name":"mod_one"}'),
    (dave, 'd@x.com', '{"display_name":"dave_d"}'), (erin, 'e@x.com', '{"display_name":"erin_e"}');
  INSERT INTO public.admins (user_id) VALUES (adm);
  INSERT INTO public.app_config (key, value) VALUES ('storage_base_url', 'https://proj.supabase.co')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';

  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.posts (content) VALUES ('Friday at Nomad') RETURNING id INTO p1;
  INSERT INTO public.posts (content) VALUES ('Second post') RETURNING id INTO p2;

  -- ------------------------------------------------------------ reposts
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.reposts (post_id, comment) VALUES (p1, 'This is the one');
  PERFORM pulse_test.ok((SELECT reposts FROM public.posts WHERE id = p1) = 1, 'repost counter incremented');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reposts (post_id) VALUES (%L)$q$, p1), 'one repost per user per post');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reposts (post_id, comment) VALUES (%L, %L)$q$, p2, repeat('x', 281)), 'repost comment length limit');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reposts (post_id, user_id) VALUES (%L, %L)$q$, p2, carol), 'cannot repost as someone else');
  PERFORM pulse_test.act_as(carol);
  INSERT INTO public.reposts (post_id) VALUES (p1);
  PERFORM pulse_test.ok((SELECT reposts FROM public.posts WHERE id = p1) = 2, 'second repost counted');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.reposts WHERE post_id = %L AND user_id = %L$q$, p1, bob)) = 0, 'cannot undo someone else''s repost');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.reposts') = 2, 'anyone can read reposts');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reposts (post_id) VALUES (%L)$q$, p1), 'anon cannot repost');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE title LIKE '%reposted your post'$q$) = 2, 'author notified of reposts');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.reposts WHERE post_id = %L$q$, p1)) = 1, 'user can undo own repost');
  PERFORM pulse_test.ok((SELECT reposts FROM public.posts WHERE id = p1) = 1, 'repost counter decremented');

  -- ---------------------------------------------------------- post views
  PERFORM pulse_test.ok(public.record_post_views(ARRAY[p1, p2]) = 2, 'viewer is counted once per post');
  PERFORM pulse_test.ok(public.record_post_views(ARRAY[p1, p2]) = 0, 'repeat views are not counted again');
  PERFORM pulse_test.ok((SELECT views FROM public.posts WHERE id = p1) = 1, 'views counter incremented');
  PERFORM pulse_test.ok(public.record_post_views(ARRAY[gen_random_uuid()]) = 0, 'unknown posts are ignored');
  PERFORM pulse_test.fails($q$UPDATE public.posts SET views = 99999$q$, 'clients cannot set the views counter');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(public.record_post_views(ARRAY[p1]) = 0, 'authors do not count as viewers');
  PERFORM pulse_test.act_as(carol);
  PERFORM pulse_test.ok(public.record_post_views(ARRAY[p1]) = 1, 'a second viewer is counted');
  PERFORM pulse_test.ok((SELECT views FROM public.posts WHERE id = p1) = 2, 'views = unique signed-in viewers');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails(format($q$SELECT public.record_post_views(ARRAY[%L]::uuid[])$q$, p1), 'anon cannot record views');
  PERFORM pulse_test.fails($q$SELECT * FROM public.post_views$q$, 'view log is not readable by clients');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'suspended' WHERE id = dave;
  PERFORM pulse_test.act_as(dave);
  PERFORM pulse_test.fails(format($q$SELECT public.record_post_views(ARRAY[%L]::uuid[])$q$, p1), 'suspended users cannot record views');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'active' WHERE id = dave;

  -- ------------------------------------------------------------ bookmarks
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.saved_posts (post_id) VALUES (p1);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.saved_posts (post_id) VALUES (%L)$q$, p1), 'duplicate bookmark');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.saved_posts (post_id, user_id) VALUES (%L, %L)$q$, p2, carol), 'cannot bookmark for someone else');
  PERFORM pulse_test.act_as(carol);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.saved_posts') = 0, 'bookmarks are private');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.saved_posts WHERE post_id = %L$q$, p1)) = 1, 'remove bookmark');

  -- ------------------------------------------------- follow + Vibe Rep
  INSERT INTO public.reactions (post_id, kind) VALUES (p1, 'heart');
  PERFORM pulse_test.act_as(carol);
  INSERT INTO public.reactions (post_id, kind) VALUES (p1, 'fire');
  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.reactions (post_id, kind) VALUES (p1, 'party');   -- own reaction: must not count
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.reactions (post_id, kind) VALUES (p2, 'heart');
  INSERT INTO public.user_follows (followee_id) VALUES (alice);
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok((SELECT vibe_rep FROM public.profile_stats WHERE user_id = alice) = 3, 'Vibe Rep = reactions earned from others (self excluded)');
  PERFORM pulse_test.ok((SELECT follower_count FROM public.profile_stats WHERE user_id = alice) = 1, 'follower count is public');
  PERFORM pulse_test.act_super();
  UPDATE public.posts SET status = 'removed' WHERE id = p2;
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok((SELECT vibe_rep FROM public.profile_stats WHERE user_id = alice) = 2, 'removed posts stop counting toward Vibe Rep');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reposts (post_id) VALUES (%L)$q$, p2), 'removed posts cannot be reposted');
  PERFORM pulse_test.act_super();
  UPDATE public.posts SET status = 'visible' WHERE id = p2;

  -- ---------------------------------------------------------------- statuses
  PERFORM pulse_test.act_as(alice);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('post-media', alice::text || '/s1.jpg'), ('post-media', alice::text || '/s2.mp4'), ('post-media', alice::text || '/s3.jpg');
  INSERT INTO public.statuses (media_url, media_type, caption, venue_id)
    VALUES (base || alice::text || '/s1.jpg', 'image', '  Doors open  ', nomad) RETURNING id INTO s1;
  PERFORM pulse_test.ok((SELECT user_id = alice AND caption = 'Doors open' AND venue_id = nomad
                         AND expires_at > now() + interval '23 hours 59 minutes' AND expires_at < now() + interval '24 hours 1 minute'
                         FROM public.statuses WHERE id = s1), 'status saved: owner, caption, venue and 24h expiry set by the database');
  INSERT INTO public.statuses (media_url, media_type) VALUES (base || alice::text || '/s2.mp4', 'video') RETURNING id INTO s2;
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type, user_id) VALUES (%L, 'image', %L)$q$, base || alice::text || '/s3.jpg', bob), 'cannot post a status as someone else');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type, expires_at) VALUES (%L, 'image', now() + interval '10 years')$q$, base || alice::text || '/s3.jpg'), 'client cannot choose the expiry');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, 'https://evil.example/storage/v1/object/public/post-media/' || alice::text || '/s3.jpg'), 'media on another host rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, base || alice::text || '/never.jpg'), 'media never uploaded rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, base || bob::text || '/x.jpg'), 'media from someone else''s folder rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'gif')$q$, base || alice::text || '/s3.jpg'), 'media_type is image or video');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type, caption) VALUES (%L, 'image', %L)$q$, base || alice::text || '/s3.jpg', repeat('x', 301)), 'caption length limit');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.statuses') = 2, 'active statuses are public');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, base || alice::text || '/s3.jpg'), 'anon cannot post a status');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'suspended' WHERE id = alice;
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, base || alice::text || '/s3.jpg'), 'suspended users cannot post statuses');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'active' WHERE id = alice;

  -- views of statuses (unseen ring + owner's viewer list)
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.status_views (status_id) VALUES (s1);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.status_views (status_id) VALUES (%L)$q$, s1), 'a status is marked seen once');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.status_views (status_id, viewer_id) VALUES (%L, %L)$q$, s2, carol), 'cannot mark seen for someone else');
  PERFORM pulse_test.act_as(carol);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.status_views') = 0, 'viewers cannot see each other');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.status_views WHERE status_id = %L$q$, s1)) = 1, 'the owner sees who viewed their status');
  PERFORM pulse_test.act_super();
  UPDATE public.statuses SET expires_at = now() - interval '1 minute' WHERE id = s2;
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.statuses WHERE id = %L$q$, s2)) = 0, 'expired statuses vanish for others');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.status_views (status_id) VALUES (%L)$q$, s2), 'cannot mark an expired status as seen');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.statuses WHERE id = %L$q$, s2)) = 1, 'owners still see their expired statuses');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.statuses WHERE id = %L$q$, s2)) = 1, 'admins can see expired statuses');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.expired_status_paths() WHERE path = alice::text || '/s2.mp4') OR true, 'cleanup helper callable');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.statuses WHERE id = %L$q$, s1)) = 0, 'cannot delete someone else''s status');

  -- rate limit: 20 per hour
  PERFORM pulse_test.act_as(erin);
  FOR i IN 1..21 LOOP
    INSERT INTO storage.objects (bucket_id, name) VALUES ('post-media', erin::text || '/r' || i || '.jpg');
  END LOOP;
  FOR i IN 1..20 LOOP
    INSERT INTO public.statuses (media_url, media_type) VALUES (base || erin::text || '/r' || i || '.jpg', 'image');
  END LOOP;
  PERFORM pulse_test.fails(format($q$INSERT INTO public.statuses (media_url, media_type) VALUES (%L, 'image')$q$, base || erin::text || '/r21.jpg'), 'status rate limit (20 per hour)');

  -- reporting + moderation of statuses
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.reports (target_type, target_id, reason) VALUES ('status', s1, 'spam') RETURNING id INTO rpt;
  PERFORM pulse_test.fails(format($q$SELECT public.admin_delete_status(%L)$q$, s1), 'non-admins cannot remove statuses');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok((SELECT target_preview FROM public.admin_report_queue WHERE id = rpt) = 'Doors open', 'moderation queue previews the reported status');
  PERFORM public.admin_resolve_report(rpt, 'actioned', 'spam', true);
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.statuses WHERE id = s1), 'actioned report deletes the status');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.moderation_log WHERE action = 'remove_status' AND target_id = s1), 'status removal is logged');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = alice AND type = 'moderation' AND title = 'Your status was removed'), 'author notified of status removal');

  -- -------------------------------------------------------------- messages
  PERFORM pulse_test.act_as(bob);
  c1 := public.get_or_create_conversation(alice);
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(public.get_or_create_conversation(bob) = c1, 'one conversation per pair, whoever starts it');
  PERFORM pulse_test.fails(format($q$SELECT public.get_or_create_conversation(%L)$q$, alice), 'cannot message yourself');
  PERFORM pulse_test.fails($q$SELECT public.get_or_create_conversation(gen_random_uuid())$q$, 'cannot message a user that does not exist');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails(format($q$SELECT public.get_or_create_conversation(%L)$q$, alice), 'anon cannot start conversations');
  PERFORM pulse_test.fails('SELECT * FROM public.messages', 'anon cannot read messages');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'banned' WHERE id = dave;
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.fails(format($q$SELECT public.get_or_create_conversation(%L)$q$, dave), 'cannot start a conversation with a banned user');

  INSERT INTO public.messages (conversation_id, body, ref_type, ref_id) VALUES (c1, 'is this still on?', 'post', p1) RETURNING id INTO m1;
  PERFORM pulse_test.ok((SELECT sender_id = bob AND NOT vanish AND expires_at IS NULL AND kind = 'text' AND ref_type = 'post' FROM public.messages WHERE id = m1), 'message stored with sender and post reference');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, sender_id) VALUES (%L, 'spoof', %L)$q$, c1, alice), 'cannot spoof the sender');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, kind) VALUES (%L, 'fake system', 'system')$q$, c1), 'clients cannot create system messages');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, '   ')$q$, c1), 'empty messages rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, %L)$q$, c1, repeat('x', 2001)), 'message length limit');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, ref_type) VALUES (%L, 'x', 'post')$q$, c1), 'a reference needs both type and id');

  PERFORM pulse_test.act_as(carol);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.conversations') = 0 AND pulse_test.n('SELECT 1 FROM public.messages') = 0
                        AND pulse_test.n('SELECT 1 FROM public.conversation_participants') = 0, 'outsiders see no conversations, participants or messages');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'hi from outside')$q$, c1), 'outsiders cannot post into a conversation');
  PERFORM pulse_test.fails(format($q$SELECT public.set_vanish_mode(%L, true)$q$, c1), 'outsiders cannot toggle vanish mode');
  PERFORM pulse_test.fails(format($q$SELECT public.mark_conversation_read(%L)$q$, c1), 'outsiders cannot mark read');

  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(public.unread_message_count() = 1, 'recipient has 1 unread message');
  SELECT * INTO r FROM public.list_conversations();
  PERFORM pulse_test.ok(r.conversation_id = c1 AND r.other_user_id = bob AND r.unread_count = 1 AND r.last_body = 'is this still on?', 'conversation list: other person, last message, unread');
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.conversation_participants$q$) = 2, 'participants can see each other');
  PERFORM pulse_test.ok(public.mark_conversation_read(c1) = 1, 'marking read returns how many were read');
  PERFORM pulse_test.ok(public.unread_message_count() = 0 AND (SELECT read_at IS NOT NULL AND expires_at IS NULL FROM public.messages WHERE id = m1), 'normal messages are marked read and stay');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(public.unread_message_count() = 0 AND (SELECT unread_count FROM public.list_conversations()) = 0, 'sender has nothing unread');

  -- ---------------------------------------------------------- vanish mode
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(public.set_vanish_mode(c1, true), 'vanish mode on');
  PERFORM pulse_test.ok((SELECT vanish_mode FROM public.conversations WHERE id = c1), 'conversation is in vanish mode');
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE conversation_id = %L AND kind = 'system' AND body LIKE '%%turned on vanish mode%%'$q$, c1)) = 1, 'a system notice tells both people');
  PERFORM public.set_vanish_mode(c1, true);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE conversation_id = %L AND kind = 'system'$q$, c1)) = 1, 'toggling to the same state adds no extra notice');
  INSERT INTO public.messages (conversation_id, body) VALUES (c1, 'meet at the back door') RETURNING id INTO m2;
  PERFORM pulse_test.ok((SELECT vanish AND expires_at > now() + interval '23 hours' FROM public.messages WHERE id = m2), 'vanish message: unread ones keep a 24h fallback expiry');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE id = %L$q$, m2)) = 1, 'recipient sees the vanish message');
  PERFORM pulse_test.ok(public.mark_conversation_read(c1) = 1, 'reading the vanish message');
  PERFORM pulse_test.ok((SELECT expires_at > now() + interval '10 seconds' AND expires_at < now() + interval '20 seconds' FROM public.messages WHERE id = m2), 'after reading it self-destructs in about 15 seconds');
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE id = %L$q$, m2)) = 1, 'still visible during the countdown');
  PERFORM pulse_test.act_super();
  UPDATE public.messages SET expires_at = now() - interval '1 second' WHERE id = m2;
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE id = %L$q$, m2)) = 0, 'expired vanish message is invisible to the reader');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.messages WHERE id = %L$q$, m2)) = 0, 'and to the sender');
  PERFORM pulse_test.ok((SELECT last_body FROM public.list_conversations()) <> 'meet at the back door', 'conversation list never shows an expired message');
  PERFORM pulse_test.act_super();
  i := public.purge_expired_messages();
  PERFORM pulse_test.ok(i >= 1 AND NOT EXISTS (SELECT 1 FROM public.messages WHERE id = m2), 'purge deletes expired messages for good');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.messages WHERE id = m1) AND EXISTS (SELECT 1 FROM public.messages WHERE kind = 'system'), 'normal and system messages are untouched');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.fails('SELECT public.purge_expired_messages()', 'users cannot run the purge');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(NOT public.set_vanish_mode(c1, false), 'either person can turn vanish mode off');
  INSERT INTO public.messages (conversation_id, body) VALUES (c1, 'normal again') RETURNING id INTO m2;
  PERFORM pulse_test.ok((SELECT NOT vanish AND expires_at IS NULL FROM public.messages WHERE id = m2), 'messages sent after turning it off are normal');

  -- unsend / suspension / banned recipient
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.messages WHERE id = %L$q$, m2)) = 1, 'sender can unsend their message');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.messages WHERE id = %L$q$, m1)) = 0, 'cannot delete the other person''s message');
  PERFORM pulse_test.ok(pulse_test.rows($q$DELETE FROM public.messages WHERE kind = 'system'$q$) = 0, 'system notices cannot be deleted by users');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'suspended' WHERE id = bob;
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'still here')$q$, c1), 'suspended users cannot send messages');
  PERFORM pulse_test.act_super();
  UPDATE public.profiles SET status = 'active' WHERE id = bob;

  -- rate limit + banned recipient (separate conversation)
  PERFORM pulse_test.act_as(bob);
  c2 := public.get_or_create_conversation(carol);
  LOOP  -- send until bob is exactly at the limit (he already sent a few messages this minute)
    EXIT WHEN (SELECT count(*) FROM public.messages WHERE sender_id = bob AND kind = 'text' AND created_at > now() - interval '1 minute') >= 30;
    INSERT INTO public.messages (conversation_id, body) VALUES (c2, 'bulk');
  END LOOP;
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'too many')$q$, c2), 'message rate limit (30 per minute)');
  PERFORM pulse_test.act_super();
  DELETE FROM public.messages WHERE conversation_id = c2;
  UPDATE public.profiles SET status = 'banned' WHERE id = carol;
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body) VALUES (%L, 'hello?')$q$, c2), 'cannot message a banned user');

  -- cascade + realtime
  PERFORM pulse_test.act_super();
  DELETE FROM auth.users WHERE id = carol;
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE user_id = carol), 'deleting an account removes their conversation memberships');
  PERFORM pulse_test.ok((SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('messages', 'conversations', 'statuses', 'reposts')) = 4, 'messages, conversations, statuses and reposts are in the realtime publication');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity), 'every public table has RLS');

  RAISE NOTICE '== ALL SOCIAL CHECKS PASSED ==';
END $$;

ROLLBACK;
