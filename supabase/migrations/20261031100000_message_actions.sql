/*
# Pulse backend 19 — message reactions, replies, forwarding, stars, pins, delete for me, message reports

Idempotent and additive. Apply after migration 16.

- `message_reactions`: one emoji per person per message (change it or take it back). Only the two people in the
  chat can see or add them. In Realtime.
- `messages.reply_to_id`: a reply quotes an earlier message of the same chat. `messages.is_forwarded`: shows
  "Forwarded" on the bubble.
- `message_stars`: your starred messages (only you see them).
- `message_hidden`: "Delete for me" — hides a message for you only. "Delete for everyone" is the existing delete
  of your own messages.
- `conversations.pinned_message_id` + `set_pinned_message(conv, message)`: either person pins (or unpins) one
  message of the chat.
- reports: 'message' is a report target; the admin report queue shows the reported message and its sender (admins
  cannot read chats otherwise).
*/

-- ============================================================================
-- Replies + forwarded flag
-- ============================================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_forwarded boolean NOT NULL DEFAULT false;
GRANT INSERT (reply_to_id, is_forwarded) ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.messages_check_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id = NEW.reply_to_id AND m.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'you can only reply to a message of this chat' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_check_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_check_reply ON public.messages;
CREATE TRIGGER messages_check_reply BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_check_reply();

/** The signed-in user is in the chat this message belongs to. */
CREATE OR REPLACE FUNCTION public.can_see_message(p_message uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.messages m WHERE m.id = p_message AND public.is_conversation_member(m.conversation_id));
$$;
REVOKE EXECUTE ON FUNCTION public.can_see_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_message(uuid) TO authenticated;

-- ============================================================================
-- Reactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO authenticated USING (public.can_see_message(message_id));
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_active_user() AND public.can_see_message(message_id));
DROP POLICY IF EXISTS message_reactions_update ON public.message_reactions;
CREATE POLICY message_reactions_update ON public.message_reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.can_see_message(message_id));
DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;
CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.message_reactions FROM anon, authenticated;
GRANT SELECT, DELETE ON public.message_reactions TO authenticated;
GRANT INSERT (message_id, emoji), UPDATE (emoji) ON public.message_reactions TO authenticated;

-- ============================================================================
-- Stars and "delete for me" (both private to you)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.message_stars (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE TABLE IF NOT EXISTS public.message_hidden (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_stars', 'message_hidden'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.can_see_message(message_id))', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())', t || '_delete', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT INSERT (message_id) ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ============================================================================
-- Pinned message
-- ============================================================================
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_pinned_message(p_conv uuid, p_message uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_conversation_member(p_conv) THEN RAISE EXCEPTION 'not your conversation' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF p_message IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.messages WHERE id = p_message AND conversation_id = p_conv) THEN
    RAISE EXCEPTION 'that message is not in this chat' USING ERRCODE = '22023';
  END IF;
  UPDATE public.conversations SET pinned_message_id = p_message WHERE id = p_conv;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_pinned_message(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pinned_message(uuid, uuid) TO authenticated;

-- ============================================================================
-- Reporting a message
-- ============================================================================
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'user', 'venue', 'event', 'review', 'status', 'message'));

-- admins see the reported message and who sent it (only reported messages; chats stay private otherwise).
-- Recreated rather than replaced, so a hand-made version with other columns cannot make this migration fail.
DROP VIEW IF EXISTS public.admin_report_queue;
CREATE VIEW public.admin_report_queue AS
SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
       rp.display_name AS reporter_name,
       CASE r.target_type
         WHEN 'post' THEN (SELECT left(p.content, 200) FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT left(c.body, 200) FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT left(coalesce(v.body, ''), 200) FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'status' THEN (SELECT coalesce(s.caption, '(' || s.media_type || ' status)') FROM public.statuses s WHERE s.id = r.target_id)
         WHEN 'message' THEN (SELECT left(m.body, 200) FROM public.messages m WHERE m.id = r.target_id)
         WHEN 'user' THEN (SELECT u.display_name FROM public.profiles u WHERE u.id = r.target_id)
         WHEN 'venue' THEN (SELECT x.name FROM public.venues x WHERE x.id = r.target_id)
         WHEN 'event' THEN (SELECT e.title FROM public.events e WHERE e.id = r.target_id)
       END AS target_preview,
       CASE r.target_type
         WHEN 'post' THEN (SELECT p.user_id FROM public.posts p WHERE p.id = r.target_id)
         WHEN 'comment' THEN (SELECT c.user_id FROM public.comments c WHERE c.id = r.target_id)
         WHEN 'review' THEN (SELECT v.user_id FROM public.reviews v WHERE v.id = r.target_id)
         WHEN 'status' THEN (SELECT s.user_id FROM public.statuses s WHERE s.id = r.target_id)
         WHEN 'message' THEN (SELECT m.sender_id FROM public.messages m WHERE m.id = r.target_id)
         WHEN 'user' THEN r.target_id
       END AS target_user_id
FROM public.reports r
LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
WHERE public.is_admin();
REVOKE ALL ON public.admin_report_queue FROM anon, authenticated;
GRANT SELECT ON public.admin_report_queue TO authenticated;

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
