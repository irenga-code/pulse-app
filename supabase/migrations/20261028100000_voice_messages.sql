/*
# Pulse backend 16 — voice messages in direct chats

Idempotent and additive. Apply after migration 15 (it extends the chat media columns that migration adds).

- `message-media` storage bucket: PRIVATE (no public URLs). Files live at `<conversation id>/<sender id>/<file>`.
  Only the two people in that conversation can read them (the app plays them through short-lived signed URLs);
  you can only upload into your own folder of a conversation you are in, and delete only your own files.
- `messages.media_type` now also accepts 'audio'. A voice note's `media_url` must point at your own folder of
  this conversation in `message-media`, and the file must already be uploaded.
- `messages.media_duration_ms` (up to 10 minutes) and `messages.media_waveform` (up to 64 bars, 0-100) so the
  bubble shows its length and waveform before the audio loads. Both optional.
*/

-- ============================================================================
-- Private bucket for chat voice notes
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('message-media', 'message-media', false, 10485760,
   ARRAY['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

/** The conversation folder of a message-media object name, if the signed-in user is in that conversation. */
CREATE OR REPLACE FUNCTION public.can_access_message_media(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id::text = (storage.foldername(p_name))[1] AND cp.user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_message_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_message_media(text) TO authenticated;

DROP POLICY IF EXISTS pulse_message_media_read ON storage.objects;
CREATE POLICY pulse_message_media_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-media' AND public.can_access_message_media(name));
DROP POLICY IF EXISTS pulse_message_media_insert ON storage.objects;
CREATE POLICY pulse_message_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-media' AND (storage.foldername(name))[2] = auth.uid()::text
              AND public.can_access_message_media(name) AND public.is_active_user());
DROP POLICY IF EXISTS pulse_message_media_delete ON storage.objects;
CREATE POLICY pulse_message_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'message-media' AND (storage.foldername(name))[2] = auth.uid()::text);

-- ============================================================================
-- Voice notes on messages
-- ============================================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_duration_ms integer,
  ADD COLUMN IF NOT EXISTS media_waveform smallint[];

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_media_type_ck;
ALTER TABLE public.messages ADD CONSTRAINT messages_media_type_ck CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'audio'));
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('messages_media_url_ck', $q$CHECK (media_url IS NULL OR media_url ~* '^https?://')$q$),
    ('messages_media_pair_ck', $q$CHECK ((media_url IS NULL) = (media_type IS NULL))$q$),
    ('messages_media_duration_ck', $q$CHECK (media_duration_ms IS NULL OR media_duration_ms BETWEEN 0 AND 600000)$q$),
    ('messages_media_waveform_ck', $q$CHECK (media_waveform IS NULL OR (cardinality(media_waveform) <= 64 AND 0 <= ALL (media_waveform) AND 100 >= ALL (media_waveform)))$q$)
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.messages'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE public.messages ADD CONSTRAINT %I %s', c.name, c.def);
    END IF;
  END LOOP;
END $$;
GRANT INSERT (media_url, media_type, media_duration_ms, media_waveform) ON public.messages TO authenticated;

/** A voice note must be a file you uploaded into your own folder of this conversation. */
CREATE OR REPLACE FUNCTION public.messages_check_audio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  folder text;
  objname text;
BEGIN
  IF NEW.media_type IS DISTINCT FROM 'audio' THEN
    NEW.media_duration_ms := NULL;
    NEW.media_waveform := NULL;
    RETURN NEW;
  END IF;
  IF uid IS NULL THEN RETURN NEW; END IF;  -- SQL editor / service role
  folder := NEW.conversation_id::text || '/' || uid::text || '/';
  objname := substring(NEW.media_url FROM '/storage/v1/object/(?:authenticated|sign|public)/message-media/([^?]+)');
  IF objname IS NULL OR left(objname, char_length(folder)) <> folder THEN
    RAISE EXCEPTION 'voice notes must be uploaded to your own message-media folder of this chat' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'message-media' AND o.name = objname) THEN
    RAISE EXCEPTION 'media file not found in storage: upload it before sending' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_check_audio() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_check_audio ON public.messages;
CREATE TRIGGER messages_check_audio BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_check_audio();

NOTIFY pgrst, 'reload schema';
