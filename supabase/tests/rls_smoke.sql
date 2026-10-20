-- Pulse backend smoke test (RLS, triggers, RPCs).
--
-- Runs entirely inside a transaction and ROLLS BACK, so it leaves no data behind.
-- Run it in the Supabase SQL editor (as postgres) or locally:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
-- Every check prints "ok - ..."; the first failure aborts with "FAIL: ...".
-- Requires migrations 1-3 to be applied (including the lockdown).
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
CREATE FUNCTION pulse_test.n(q text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int;
BEGIN EXECUTE 'SELECT count(*)::int FROM (' || q || ') t' INTO c; RETURN c; END $$;
CREATE FUNCTION pulse_test.rows(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int;
BEGIN EXECUTE stmt; GET DIAGNOSTICS c = ROW_COUNT; RETURN c; END $$;

DO $$
DECLARE
  alice constant uuid := 'a0000000-0000-0000-0000-000000000001';
  bob   constant uuid := 'a0000000-0000-0000-0000-000000000002';
  mgr   constant uuid := 'a0000000-0000-0000-0000-000000000003';
  adm   constant uuid := 'a0000000-0000-0000-0000-000000000004';
  carol constant uuid := 'a0000000-0000-0000-0000-000000000005';
  nomad uuid; thrones uuid;
  p_alice uuid; p_mgr uuid; p_bob uuid; p_off uuid; c1 uuid; rpt uuid; ev uuid; vr uuid; ev_draft uuid;
  before_n int; r public.venues;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (alice, 'alice.real@example.com', '{"display_name":"alice_k"}'),
    (bob,   'bob.real@example.com',   '{"display_name":"bob_b"}'),
    (mgr,   'mgr.real@example.com',   '{"display_name":"nomad_mgr"}'),
    (adm,   'adm.real@example.com',   '{"display_name":"mod_one"}'),
    (carol, 'carol.real@example.com', NULL);
  INSERT INTO public.admins (user_id) VALUES (adm);
  SELECT id INTO nomad FROM public.venues WHERE name = 'Nomad';
  SELECT id INTO thrones FROM public.venues WHERE name = 'Thrones';
  INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (nomad, mgr, 'owner');
  UPDATE public.venues SET is_verified = true WHERE id = nomad;

  -- ------------------------------------------------- 1. identity & privacy
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id = alice) = 'alice_k', 'profile created from signup display_name');
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id = carol) LIKE 'pulse\_%', 'no display_name -> generated handle, not email');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name ILIKE '%email%'), 'profiles has no email column');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.profiles WHERE display_name LIKE '%@%'), 'no profile exposes an email-like name');
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('a0000000-0000-0000-0000-0000000000f1', 'x@example.com', '{"display_name":"x@example.com"}');
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('a0000000-0000-0000-0000-0000000000f2', 'y@example.com', '{"display_name":"ALICE_K"}');
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id='a0000000-0000-0000-0000-0000000000f1') LIKE 'pulse\_%', 'email-looking display_name rejected at signup');
  PERFORM pulse_test.ok((SELECT display_name FROM public.profiles WHERE id='a0000000-0000-0000-0000-0000000000f2') <> 'ALICE_K', 'duplicate display_name gets a unique variant');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.user_preferences WHERE user_id = alice), 'preferences row created on signup');

  -- ------------------------------------------------------------ 2. anonymous
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content) VALUES ('anon post')$q$, 'anon cannot post');
  PERFORM pulse_test.fails($q$UPDATE public.venues SET name = 'x'$q$, 'anon cannot edit venues');
  PERFORM pulse_test.fails($q$DELETE FROM public.venues$q$, 'anon cannot delete venues');
  PERFORM pulse_test.fails($q$INSERT INTO public.saved_venues (venue_id) VALUES (gen_random_uuid())$q$, 'anon cannot save venues');
  PERFORM pulse_test.fails($q$SELECT * FROM public.admins$q$, 'anon cannot read admins');
  PERFORM pulse_test.fails($q$SELECT public.set_venue_status(gen_random_uuid(), 'live')$q$, 'anon cannot call set_venue_status');
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.venues') >= 8, 'anon can read venues');
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.profiles') >= 5, 'anon can read public profiles');
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.notifications WHERE user_id IS NOT NULL') = 0, 'anon sees broadcast notifications only');

  -- --------------------------------------------------------- 3. profile edits
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET account_type = 'venue' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'user cannot self-promote account_type');
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET is_verified = true WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'user cannot self-verify');
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET status = 'active' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'user cannot change own status');
  PERFORM pulse_test.ok(pulse_test.rows($q$UPDATE public.profiles SET bio = 'night owl' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$) = 1, 'user can edit own bio');
  PERFORM pulse_test.ok(pulse_test.rows($q$UPDATE public.profiles SET bio = 'hacked' WHERE id = 'a0000000-0000-0000-0000-000000000002'$q$) = 0, 'user cannot edit someone else''s profile');
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET display_name = 'admin' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'reserved display name blocked');
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET display_name = 'me@mail.com' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'email as display name blocked');
  PERFORM pulse_test.fails($q$UPDATE public.profiles SET display_name = 'BOB_B' WHERE id = 'a0000000-0000-0000-0000-000000000001'$q$, 'duplicate display name blocked');

  -- ----------------------------------------------------------------- 4. posts
  INSERT INTO public.posts (content) VALUES ('Nomad tonight?!') RETURNING id INTO p_alice;
  PERFORM pulse_test.ok((SELECT user_name FROM public.posts WHERE id = p_alice) = 'alice_k', 'post author name stamped by DB');
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, user_name) VALUES ('spoof', 'someone_else')$q$, 'client cannot set user_name');
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, is_official) VALUES ('fake badge', true)$q$, 'client cannot set is_official');
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, likes) VALUES ('fake likes', 999)$q$, 'client cannot set counters');
  INSERT INTO public.posts (content, venue_id) VALUES ('Outside Nomad now', nomad);
  PERFORM pulse_test.ok((SELECT NOT is_official AND venue_name = 'Nomad' FROM public.posts WHERE content = 'Outside Nomad now'), 'non-manager venue post is NOT official; venue_name set by DB');
  PERFORM pulse_test.fails($q$UPDATE public.posts SET likes = 500 WHERE id = (SELECT id FROM public.posts LIMIT 1)$q$, 'user cannot edit counters');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.posts SET content = 'edited' WHERE id = %L$q$, p_alice)) = 1, 'author can edit own post');

  PERFORM pulse_test.act_as(mgr);
  INSERT INTO public.posts (content, venue_id) VALUES ('Doors open 9pm. DJ set from 11.', nomad) RETURNING id INTO p_off;
  PERFORM pulse_test.ok((SELECT is_official FROM public.posts WHERE id = p_off), 'verified venue manager post gets Official badge');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.posts SET content = 'hijack' WHERE id = %L$q$, p_alice)) = 0, 'manager cannot edit users'' posts');

  -- ---------------------------------------------- 5. comments, reactions, counters
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.comments (post_id, body) VALUES (p_alice, 'I''m in!') RETURNING id INTO c1;
  PERFORM pulse_test.ok((SELECT user_name FROM public.comments WHERE id = c1) = 'bob_b', 'comment author stamped by DB');
  PERFORM pulse_test.ok((SELECT comments FROM public.posts WHERE id = p_alice) = 1, 'comment counter incremented by trigger');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.comments (post_id, body) VALUES (%L, %L)$q$, p_alice, repeat('x', 501)), 'comment length capped');
  INSERT INTO public.reactions (post_id, kind) VALUES (p_alice, 'fire');
  PERFORM pulse_test.ok((SELECT likes FROM public.posts WHERE id = p_alice) = 1, 'reaction counter incremented');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'heart')$q$, p_alice), 'one reaction per user per post');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'poop')$q$, p_alice), 'only fire/heart/party allowed');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.reactions SET kind = 'party' WHERE post_id = %L$q$, p_alice)) = 1, 'user can switch reaction');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.comments SET body = 'edit' WHERE id = %L$q$, c1)) = 1, 'author can edit own comment');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.comments SET body = 'edit' WHERE id = %L$q$, c1)) = 0, 'cannot edit someone else''s comment');
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'comment' AND user_id = 'a0000000-0000-0000-0000-000000000001'$q$) = 1, 'post author notified of comment');
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'reaction'$q$) = 1, 'post author notified of reaction');
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE user_id = 'a0000000-0000-0000-0000-000000000002'$q$) = 0, 'cannot see other users'' notifications');
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE user_id IS NULL$q$) >= 3, 'broadcast notifications visible to signed-in users');
  PERFORM pulse_test.ok(public.unread_notification_count() >= 5, 'unread count includes personal + broadcast');
  PERFORM public.mark_all_notifications_read();
  PERFORM pulse_test.ok(public.unread_notification_count() = 0, 'mark all read works');
  UPDATE public.user_preferences SET community_alerts = false WHERE user_id = alice;
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.comments (post_id, body) VALUES (p_alice, 'second comment');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'comment'$q$) = 1, 'community_alerts=false suppresses new comment notifications');
  UPDATE public.user_preferences SET community_alerts = true WHERE user_id = alice;
  PERFORM pulse_test.fails($q$UPDATE public.user_preferences SET theme = 'neon' WHERE user_id = 'a0000000-0000-0000-0000-000000000001'$q$, 'invalid theme rejected');
  PERFORM pulse_test.ok(pulse_test.rows($q$UPDATE public.user_preferences SET theme = 'light' WHERE user_id = 'a0000000-0000-0000-0000-000000000001'$q$) = 1, 'user can update own preferences');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.user_preferences WHERE user_id = 'a0000000-0000-0000-0000-000000000001'$q$) = 0, 'preferences are private');
  DELETE FROM public.reactions WHERE post_id = p_alice;
  PERFORM pulse_test.ok((SELECT likes FROM public.posts WHERE id = p_alice) = 0, 'counter decremented on delete');

  -- -------------------------------------------- 6. venue status + expiry
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.fails(format($q$SELECT public.set_venue_status(%L, 'live')$q$, nomad), 'non-manager cannot set venue status');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET status = 'live' WHERE id = %L$q$, nomad), 'direct status update blocked');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'x' WHERE id = %L$q$, nomad)) = 0, 'non-manager cannot edit venue details');
  PERFORM pulse_test.act_as(mgr);
  PERFORM pulse_test.fails(format($q$SELECT public.set_venue_status(%L, 'busy')$q$, nomad), 'old busy status rejected');
  PERFORM pulse_test.fails(format($q$SELECT public.set_venue_status(%L, 'live', 5)$q$, nomad), 'duration below 15 min rejected');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET name = 'Renamed' WHERE id = %L$q$, nomad), 'manager cannot rename venue');
  PERFORM pulse_test.fails(format($q$UPDATE public.venues SET is_verified = true WHERE id = %L$q$, thrones), 'manager cannot self-verify a venue');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'Best nights on Ggaba Road' WHERE id = %L$q$, nomad)) = 1, 'manager can edit own venue description');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venues SET description = 'x' WHERE id = %L$q$, thrones)) = 0, 'manager cannot edit another venue');
  SELECT * INTO r FROM public.set_venue_status(nomad, 'live', 60);
  PERFORM pulse_test.ok(r.status = 'live' AND r.status_expires_at > now() + interval '59 minutes', 'manager sets live with expiry');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok((SELECT status FROM public.venues_public WHERE id = nomad) = 'live', 'venues_public shows live');
  PERFORM pulse_test.act_super();
  UPDATE public.venues SET status_expires_at = now() - interval '1 minute' WHERE id = nomad;
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok((SELECT status FROM public.venues_public WHERE id = nomad) = 'not_active', 'expired live shows as not_active immediately');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT status FROM public.venues WHERE id = nomad) = 'live', 'stored status is still live until sweep');
  PERFORM pulse_test.ok(public.expire_venue_statuses() >= 1, 'expire_venue_statuses sweeps expired rows');
  PERFORM pulse_test.ok((SELECT status FROM public.venues WHERE id = nomad) = 'not_active', 'stored status flipped to not_active');
  INSERT INTO public.venues (name, location, status) VALUES ('Probe', 'Kampala', 'live');
  PERFORM pulse_test.ok((SELECT status_expires_at IS NOT NULL FROM public.venues WHERE name = 'Probe'), 'live without expiry gets default expiry');
  DELETE FROM public.venues WHERE name = 'Probe';
  PERFORM pulse_test.ok((SELECT count(*) FROM public.venues WHERE name = 'Taboo' AND location = 'Bugolobi') = 1, 'Taboo is in Bugolobi');

  -- -------------------------------------- 7. follows + live notifications
  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.venue_follows (venue_id) VALUES (nomad);
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.venue_follows') = 0, 'follow rows are private');
  PERFORM pulse_test.ok((SELECT follower_count FROM public.venue_stats WHERE venue_id = nomad) = 1, 'venue_stats exposes follower count only');
  PERFORM pulse_test.act_as(mgr);
  PERFORM public.set_venue_status(nomad, 'live', 60);
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'venue_live'$q$) = 1, 'follower notified when venue goes live');
  PERFORM pulse_test.act_as(mgr);
  PERFORM public.set_venue_status(nomad, 'not_active');
  PERFORM pulse_test.act_as(alice);
  UPDATE public.user_preferences SET live_venue_alerts = false WHERE user_id = alice;
  PERFORM pulse_test.act_as(mgr);
  PERFORM public.set_venue_status(nomad, 'live', 60);
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'venue_live'$q$) = 1, 'live_venue_alerts=false suppresses live notifications');
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.user_follows (followee_id) VALUES (alice);
  PERFORM pulse_test.fails($q$INSERT INTO public.user_follows (followee_id) VALUES ('a0000000-0000-0000-0000-000000000002')$q$, 'cannot follow yourself');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'follow'$q$) = 1, 'user notified of new follower');
  PERFORM pulse_test.act_as(carol);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.user_follows') = 0, 'third parties cannot see follow graph');

  -- ----------------------------------------------------------- 8. saved venues
  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.saved_venues (venue_id) VALUES (nomad);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.saved_venues (venue_id, user_id) VALUES (%L, 'a0000000-0000-0000-0000-000000000002')$q$, thrones), 'cannot save on behalf of another user');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.saved_venues (venue_id) VALUES (%L)$q$, nomad), 'duplicate save rejected');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.saved_venues') = 0, 'saved venues are private');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.saved_venues WHERE venue_id = %L$q$, nomad)) = 1, 'user can unsave');

  -- ------------------------------------------------------------- 9. events
  PERFORM pulse_test.act_as(mgr);
  INSERT INTO public.events (venue_id, title, starts_at, status) VALUES (nomad, 'Friday Afrobeats', now() + interval '2 days', 'draft') RETURNING id INTO ev_draft;
  INSERT INTO public.events (venue_id, title, starts_at, ends_at, status) VALUES (nomad, 'Saturday Live', now() + interval '3 days', now() + interval '3 days 6 hours', 'published') RETURNING id INTO ev;
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.events WHERE id = %L$q$, ev_draft)) = 0, 'drafts hidden from public');
  PERFORM pulse_test.ok((SELECT phase FROM public.events_feed WHERE id = ev) = 'upcoming', 'events_feed phase = upcoming');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.events (venue_id, title, starts_at) VALUES (%L, 'Rogue event', now())$q$, nomad), 'non-manager cannot create events');
  INSERT INTO public.event_rsvps (event_id, kind) VALUES (ev, 'going');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.event_rsvps (event_id, kind) VALUES (%L, 'going')$q$, ev_draft), 'cannot RSVP to unpublished event');
  PERFORM pulse_test.act_super();
  UPDATE public.events SET starts_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' WHERE id = ev;
  PERFORM pulse_test.ok((SELECT phase FROM public.events_feed WHERE id = ev) = 'live_now', 'events_feed phase = live_now');

  -- --------------------------------------- 10. moderation, reports, suspension
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.posts (content) VALUES ('buy cheap followers!!!') RETURNING id INTO p_bob;
  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.reports (target_type, target_id, reason, details) VALUES ('post', p_bob, 'spam', 'selling followers') RETURNING id INTO rpt;
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reports (target_type, target_id, reason) VALUES ('post', %L, 'spam')$q$, p_bob), 'duplicate open report rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reports (target_type, target_id, reason, reporter_id) VALUES ('post', %L, 'scam', %L)$q$, p_bob, bob), 'cannot file a report as someone else');
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.admin_report_queue') = 0, 'non-admin sees empty moderation queue');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_resolve_report(%L, 'actioned')$q$, rpt), 'non-admin cannot resolve reports');
  PERFORM pulse_test.fails($q$SELECT public.admin_set_user_status('a0000000-0000-0000-0000-000000000002', 'banned')$q$, 'non-admin cannot ban');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.reports') = 0, 'reported user cannot see reports about them');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.admin_report_queue') = 1, 'admin sees the report in the queue');
  PERFORM pulse_test.ok((SELECT target_preview FROM public.admin_report_queue LIMIT 1) LIKE 'buy cheap%', 'queue shows reported content');
  PERFORM pulse_test.fails($q$SELECT public.admin_set_user_status('a0000000-0000-0000-0000-000000000004', 'banned')$q$, 'admin cannot moderate themselves');
  PERFORM public.admin_resolve_report(rpt, 'actioned', 'spam removed', true);
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, p_bob)) = 0, 'removed post hidden from public');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'moderation'$q$) = 1, 'author notified of removal (even though prefs allow)');
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_set_user_status(bob, 'suspended', 'spam');
  PERFORM pulse_test.act_as(bob);
  PERFORM pulse_test.fails($q$INSERT INTO public.posts (content) VALUES ('still here')$q$, 'suspended user cannot post');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.comments (post_id, body) VALUES (%L, 'hi')$q$, p_alice), 'suspended user cannot comment');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'fire')$q$, p_alice), 'suspended user cannot react');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.saved_venues (venue_id) VALUES (%L)$q$, nomad), 'suspended user cannot save venues');
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_set_user_status(bob, 'banned', 'repeat offender');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT banned_until > now() + interval '10 years' FROM auth.users WHERE id = bob), 'ban also blocks sign-in (auth.users.banned_until)');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.profiles WHERE id = %L$q$, bob)) = 0, 'banned profiles hidden from others');
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_set_user_status(bob, 'active', 'appeal accepted');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT banned_until IS NULL FROM auth.users WHERE id = bob), 'reinstating lifts the sign-in ban');
  PERFORM pulse_test.act_as(bob);
  INSERT INTO public.posts (content) VALUES ('back, sorry');
  PERFORM pulse_test.ok(true, 'reinstated user can post again');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.moderation_log') >= 4, 'admin actions are logged');
  PERFORM pulse_test.act_as(alice);
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.moderation_log') = 0, 'moderation log is admin-only');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.posts WHERE id = %L$q$, p_mgr)) = 0, 'user cannot delete posts they do not own');
  PERFORM pulse_test.act_as(adm);
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.posts WHERE id = %L$q$, p_off)) = 1, 'admin can delete any post');

  -- --------------------------------------------------- 11. verification flow
  PERFORM pulse_test.act_as(carol);
  INSERT INTO public.verification_requests (kind, role, message) VALUES ('host', 'Mc', 'I MC at Thrones on Fridays');
  PERFORM pulse_test.fails($q$INSERT INTO public.verification_requests (kind, role) VALUES ('host', 'Dj')$q$, 'duplicate pending request rejected');
  PERFORM pulse_test.fails($q$UPDATE public.verification_requests SET status = 'approved'$q$, 'user cannot approve own request');
  PERFORM pulse_test.act_as(alice);
  INSERT INTO public.verification_requests (kind, venue_id, message) VALUES ('venue', thrones, 'I run Thrones') RETURNING id INTO vr;
  PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.verification_requests') = 1, 'users only see their own requests');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_review_verification(%L, true)$q$, vr), 'non-admin cannot review requests');
  PERFORM pulse_test.act_as(adm);
  PERFORM public.admin_review_verification(vr, true, 'verified by phone');
  PERFORM pulse_test.fails(format($q$SELECT public.admin_review_verification(%L, true)$q$, vr), 'request cannot be reviewed twice');
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok((SELECT account_type = 'venue' AND is_verified FROM public.profiles WHERE id = alice), 'approval upgrades the account type');
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.venue_managers WHERE venue_id = thrones AND user_id = alice), 'approval links the user to the venue');
  PERFORM pulse_test.ok((SELECT is_verified FROM public.venues WHERE id = thrones), 'approval verifies the venue');
  PERFORM pulse_test.act_as(alice);
  PERFORM public.set_venue_status(thrones, 'sold_out', 120);
  PERFORM pulse_test.ok((SELECT status FROM public.venues WHERE id = thrones) = 'sold_out', 'new venue account can mark Sold out');

  -- --------------------------------------------------------- 12. storage rules
  PERFORM pulse_test.act_as(alice);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', alice::text || '/me.png');
  PERFORM pulse_test.fails($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'a0000000-0000-0000-0000-000000000002/me.png')$q$, 'cannot upload into another user''s folder');
  PERFORM pulse_test.act_anon();
  PERFORM pulse_test.fails($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'x/y.png')$q$, 'anon cannot upload');

  -- ------------------------------------------- 13. legacy/service-role writes
  PERFORM pulse_test.act_super();
  INSERT INTO public.posts (user_name, content) VALUES ('Seed User', 'seeded from SQL editor');
  PERFORM pulse_test.ok(true, 'service role / SQL editor can still seed posts');

  -- ------------------------------------------------------ 14. account deletion
  PERFORM pulse_test.act_as(carol);
  PERFORM public.delete_my_account();
  PERFORM pulse_test.act_super();
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = carol), 'delete_my_account cascades profile removal');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.verification_requests WHERE user_id = carol), '...and their requests');


  -- ----------------------------------------------- 15. emoji palette (posts)
  DECLARE
    sp uuid; sp2 uuid; pr uuid; base text := 'https://proj.supabase.co/storage/v1/object/public/post-media/';
  BEGIN
    PERFORM pulse_test.act_anon();
    PERFORM pulse_test.ok(pulse_test.n('SELECT 1 FROM public.reaction_types WHERE active') >= 10, 'anyone can read the emoji palette');
    PERFORM pulse_test.fails($q$INSERT INTO public.reaction_types (kind, emoji, label) VALUES ('x_test', 'x', 'X')$q$, 'anon cannot edit the palette');
    PERFORM pulse_test.act_as(bob);
    PERFORM pulse_test.fails($q$INSERT INTO public.reaction_types (kind, emoji, label) VALUES ('x_test', 'x', 'X')$q$, 'users cannot edit the palette');
    PERFORM pulse_test.act_as(alice);
    INSERT INTO public.posts (content) VALUES ('palette test') RETURNING id INTO pr;
    PERFORM pulse_test.act_as(bob);
    INSERT INTO public.reactions (post_id, kind) VALUES (pr, 'dance');
    PERFORM pulse_test.ok((SELECT likes FROM public.posts WHERE id = pr) = 1, 'new palette emoji (dance) is accepted and counted');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'nope')$q$, pr), 'unknown emoji kind rejected by FK');
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.ok(pulse_test.n($q$SELECT 1 FROM public.notifications WHERE type = 'reaction' AND title LIKE '%💃%'$q$) = 1, 'reaction notification shows the emoji from the palette');
    PERFORM pulse_test.act_as(adm);
    UPDATE public.reaction_types SET active = false WHERE kind = 'cool';
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'cool')$q$, pr), 'retired (inactive) emoji cannot be used');
    PERFORM pulse_test.act_as(adm);
    UPDATE public.reaction_types SET active = true WHERE kind = 'cool';
    PERFORM pulse_test.act_super();
    PERFORM pulse_test.ok((SELECT relreplident = 'f' FROM pg_class WHERE oid = 'public.reactions'::regclass), 'reactions realtime DELETE events carry the emoji (REPLICA IDENTITY FULL)');

    -- ------------------------------------------------ 16. venue vibes
    PERFORM pulse_test.act_as(alice);
    INSERT INTO public.venue_reactions (venue_id, kind) VALUES (nomad, 'fire');
    PERFORM pulse_test.act_as(bob);
    INSERT INTO public.venue_reactions (venue_id, kind) VALUES (nomad, 'fire');
    PERFORM pulse_test.act_anon();
    PERFORM pulse_test.ok((SELECT n FROM public.venue_vibe_counts WHERE venue_id = nomad AND kind = 'fire') = 2, 'venue vibe counts are public');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_reactions (venue_id, kind) VALUES (%L, 'fire')$q$, nomad), 'anon cannot react to venues');
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_reactions (venue_id, kind) VALUES (%L, 'fire')$q$, nomad), 'one vibe per user per venue');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_reactions (venue_id, kind, user_id) VALUES (%L, 'fire', %L)$q$, thrones, bob), 'cannot react as someone else');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.venue_reactions (venue_id, kind) VALUES (%L, 'nope')$q$, thrones), 'venue vibe needs a palette emoji');
    PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venue_reactions SET kind = 'music' WHERE venue_id = %L$q$, nomad)) = 1, 'user can change their vibe');
    PERFORM pulse_test.ok((SELECT n FROM public.venue_vibe_counts WHERE venue_id = nomad AND kind = 'music') = 1
                          AND (SELECT n FROM public.venue_vibe_counts WHERE venue_id = nomad AND kind = 'fire') = 1, 'counts follow the change');
    PERFORM pulse_test.ok(pulse_test.rows(format($q$UPDATE public.venue_reactions SET kind = 'wow' WHERE venue_id = %L AND user_id = %L$q$, nomad, bob)) = 0, 'cannot change someone else''s vibe');
    PERFORM pulse_test.act_super();
    UPDATE public.venue_reactions SET reacted_at = now() - interval '13 hours' WHERE venue_id = nomad AND user_id = bob;
    PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM public.venue_vibe_counts WHERE venue_id = nomad AND kind = 'fire'), 'vibes older than 12 hours stop counting');
    PERFORM pulse_test.act_as(bob);
    PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM public.venue_reactions WHERE venue_id = %L$q$, nomad)) = 1, 'user can remove their vibe');

    -- ------------------------------------------------------ 17. snaps
    -- the app uploads first, then posts: files must exist in Storage, and the host is pinned
    PERFORM pulse_test.act_super();
    INSERT INTO public.app_config (key, value) VALUES ('storage_base_url', 'https://proj.supabase.co')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.fails($q$SELECT * FROM public.app_config$q$, 'clients cannot read server config');
    INSERT INTO storage.objects (bucket_id, name) VALUES
      ('post-media', alice::text || '/snap1.jpg'), ('post-media', alice::text || '/clip1.mp4'), ('post-media', alice::text || '/x.jpg');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type) VALUES ('', 'snap', %L, 'image')$q$,
      'https://evil.example/storage/v1/object/public/post-media/' || alice::text || '/snap1.jpg'), 'media on another host is rejected (origin pinned)');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type) VALUES ('', 'snap', %L, 'image')$q$,
      base || alice::text || '/never-uploaded.jpg'), 'media that was never uploaded is rejected');
    INSERT INTO public.posts (content, kind, media_url, media_type, media_width, media_height, media_meta, venue_id)
    VALUES ('', 'snap', base || alice::text || '/snap1.jpg', 'image', 720, 1280, '{"filter":"neon","geo":"Kampala"}', nomad)
    RETURNING id INTO sp;
    PERFORM pulse_test.ok((SELECT kind = 'snap' AND expires_at > now() + interval '23 hours 59 minutes' AND expires_at < now() + interval '24 hours 1 minute'
                           AND media_meta ->> 'filter' = 'neon' AND venue_name = 'Nomad' FROM public.posts WHERE id = sp), 'snap saved with 24h expiry, metadata and venue');
    INSERT INTO public.posts (content, kind, media_url, media_type, media_duration_ms)
    VALUES ('live!', 'snap', base || alice::text || '/clip1.mp4', 'video', 8200) RETURNING id INTO sp2;
    PERFORM pulse_test.ok((SELECT media_type = 'video' AND media_duration_ms = 8200 FROM public.posts WHERE id = sp2), 'video snap accepted');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type) VALUES ('', 'snap', %L, 'image')$q$, base || bob::text || '/steal.jpg'), 'media must be in your own folder');
    PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, kind, media_url, media_type) VALUES ('', 'snap', 'https://evil.example/pixel.png', 'image')$q$, 'external media URLs rejected');
    PERFORM pulse_test.fails($q$INSERT INTO public.posts (content, kind) VALUES ('no media', 'snap')$q$, 'a snap needs media');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url) VALUES ('', 'snap', %L)$q$, base || alice::text || '/x.jpg'), 'media needs a media_type');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type, expires_at) VALUES ('', 'snap', %L, 'image', now() + interval '10 years')$q$, base || alice::text || '/x.jpg'), 'client cannot choose the expiry');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type, media_meta) VALUES ('', 'snap', %L, 'image', jsonb_build_object('x', repeat('a', 3000)))$q$, base || alice::text || '/x.jpg'), 'metadata size is capped');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.posts (content, kind, media_url, media_type, media_width) VALUES ('', 'snap', %L, 'image', 99999)$q$, base || alice::text || '/x.jpg'), 'media dimensions are bounded');
    PERFORM pulse_test.fails($q$INSERT INTO public.posts (content) VALUES ('')$q$, 'empty text post without media rejected');
    PERFORM pulse_test.act_anon();
    PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, sp)) = 1, 'active snaps are public');
    PERFORM pulse_test.act_super();
    UPDATE public.posts SET expires_at = now() - interval '2 hours' WHERE id = sp;
    PERFORM pulse_test.act_anon();
    PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, sp)) = 0, 'expired snaps vanish for the public');
    PERFORM pulse_test.act_as(bob);
    PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, sp)) = 0, 'expired snaps vanish for other users');
    PERFORM pulse_test.fails(format($q$INSERT INTO public.reactions (post_id, kind) VALUES (%L, 'fire')$q$, sp), 'cannot react to an expired snap');
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, sp)) = 1, 'authors still see their own expired snaps');
    PERFORM pulse_test.act_as(adm);
    PERFORM pulse_test.ok(pulse_test.n(format($q$SELECT 1 FROM public.posts WHERE id = %L$q$, sp)) = 1, 'admins can still see expired snaps');
    PERFORM pulse_test.act_super();
    PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM public.expired_snap_paths() WHERE path = alice::text || '/snap1.jpg'), 'expired_snap_paths lists files for cleanup');
    PERFORM pulse_test.act_as(alice);
    PERFORM pulse_test.fails($q$SELECT * FROM public.expired_snap_paths()$q$, 'users cannot call the cleanup helper');
    PERFORM pulse_test.act_super();
    PERFORM pulse_test.ok((SELECT 'video/mp4' = ANY (allowed_mime_types) AND 'video/webm' = ANY (allowed_mime_types) AND file_size_limit >= 20000000
                           FROM storage.buckets WHERE id = 'post-media'), 'post-media bucket accepts short videos');
    PERFORM pulse_test.act_as(alice);
    INSERT INTO storage.objects (bucket_id, name) VALUES ('post-media', alice::text || '/clip2.webm');
    PERFORM pulse_test.fails($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('post-media', 'a0000000-0000-0000-0000-000000000002/x.webm')$q$, 'cannot upload media into another user''s folder');
  END;

  RAISE NOTICE '== ALL CHECKS PASSED ==';
END $$;

ROLLBACK;
