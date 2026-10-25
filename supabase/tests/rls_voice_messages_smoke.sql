-- Pulse voice messages smoke test (migration 16).
-- Runs in a transaction and ROLLS BACK. Needs migrations 1-16.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_voice_messages_smoke.sql
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
  a   constant uuid := 'a0000000-0000-0000-0000-0000000000a1';
  b   constant uuid := 'a0000000-0000-0000-0000-0000000000a2';
  eve constant uuid := 'a0000000-0000-0000-0000-0000000000a3';
  conv uuid; other_conv uuid; f text; url text; m uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (a,   'vm.a@example.com',   '{"display_name":"vm_a"}'),
    (b,   'vm.b@example.com',   '{"display_name":"vm_b"}'),
    (eve, 'vm.eve@example.com', '{"display_name":"vm_eve"}');

  PERFORM pulse_test.ok((SELECT NOT public FROM storage.buckets WHERE id = 'message-media'), 'message-media bucket exists and is private');
  PERFORM pulse_test.ok((SELECT 'audio/mp4' = ANY (allowed_mime_types) AND 'audio/webm' = ANY (allowed_mime_types) FROM storage.buckets WHERE id = 'message-media'), 'bucket takes webm and mp4 audio');

  PERFORM pulse_test.act_as(a);
  conv := public.get_or_create_conversation(b);
  other_conv := public.get_or_create_conversation(eve);
  f := conv::text || '/' || a::text || '/note.webm';
  url := 'https://proj.supabase.co/storage/v1/object/authenticated/message-media/' || f;

  -- storage
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-media', f, a);
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM storage.objects WHERE name = f), 'a member uploads into their own folder of the chat');
  PERFORM pulse_test.fails(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('message-media', %L)$q$, conv::text || '/' || b::text || '/x.webm'), 'cannot upload into the other person''s folder');
  PERFORM pulse_test.act_as(eve);
  PERFORM pulse_test.fails(format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('message-media', %L)$q$, conv::text || '/' || eve::text || '/x.webm'), 'an outsider cannot upload into a chat they are not in');
  PERFORM pulse_test.ok(NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = f), 'an outsider cannot see the voice note file');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok(EXISTS (SELECT 1 FROM storage.objects WHERE name = f), 'the other member can read the voice note file');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM storage.objects WHERE name = %L$q$, f)) = 0, 'the other member cannot delete it');

  -- messages
  PERFORM pulse_test.act_as(a);
  INSERT INTO public.messages (conversation_id, body, media_url, media_type, media_duration_ms, media_waveform)
  VALUES (conv, '🎤 Voice message', url, 'audio', 4200, ARRAY[10, 55, 100, 0]::smallint[]) RETURNING id INTO m;
  PERFORM pulse_test.ok((SELECT media_type = 'audio' AND media_duration_ms = 4200 AND cardinality(media_waveform) = 4 FROM public.messages WHERE id = m), 'a voice note is sent with duration and waveform');
  PERFORM pulse_test.act_as(b);
  PERFORM pulse_test.ok((SELECT media_url FROM public.messages WHERE id = m) = url, 'the other member receives it');
  PERFORM pulse_test.act_as(a);
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type) VALUES (%L, 'v', %L, 'audio')$q$, conv,
    'https://proj.supabase.co/storage/v1/object/authenticated/message-media/' || conv::text || '/' || a::text || '/missing.webm'), 'the file must be uploaded first');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type) VALUES (%L, 'v', %L, 'audio')$q$, other_conv, url), 'a file from another chat cannot be reused');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type) VALUES (%L, 'v', 'https://evil.example/a.webm', 'audio')$q$, conv), 'voice notes must come from message-media');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type, media_duration_ms) VALUES (%L, 'v', %L, 'audio', 700000)$q$, conv, url), 'longer than 10 minutes is rejected');
  PERFORM pulse_test.fails(format($q$INSERT INTO public.messages (conversation_id, body, media_url, media_type, media_waveform) VALUES (%L, 'v', %L, 'audio', ARRAY[101]::smallint[])$q$, conv, url), 'waveform bars are 0-100');
  INSERT INTO public.messages (conversation_id, body, media_url, media_type, media_duration_ms) VALUES (conv, '📸 Snap', 'https://x/snap.jpg', 'image', 999) RETURNING id INTO m;
  PERFORM pulse_test.ok((SELECT media_duration_ms IS NULL FROM public.messages WHERE id = m), 'photo snaps still work (and carry no audio fields)');
  PERFORM pulse_test.ok(pulse_test.rows(format($q$DELETE FROM storage.objects WHERE name = %L$q$, f)) = 1, 'the sender can delete their own file');

  PERFORM pulse_test.act_super();
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
