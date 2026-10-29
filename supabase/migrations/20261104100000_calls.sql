/*
# Pulse backend 23 — 1-on-1 voice and video calls (WebRTC, signalled over Supabase Realtime)

Idempotent and additive. Apply after migration 20 (user_blocks).

- `calls`: one row per call. The server stamps `caller_id` (auth.uid()), so the person being called can trust who is
  calling: the app only rings for an invite whose call row says so. A call can only be placed to someone you share a
  chat with and neither of you has blocked (`can_call`). Both people can read the row and move its `status` on.
- Signalling (offer / answer / ICE candidates) goes over private Realtime broadcast channels, one inbox per user:
  `call:<user id>`. Only that user can listen to their inbox; only people allowed to call them can post to it.
  Signals carry the call id, a random uuid only the two people can see, and the app ignores any that do not match.
- Realtime > Settings: private channels must be allowed (they are by default). Calls need no table in the
  supabase_realtime publication.
*/

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'ringing',
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  CONSTRAINT calls_kind CHECK (kind IN ('audio', 'video')),
  CONSTRAINT calls_status CHECK (status IN ('ringing', 'accepted', 'declined', 'missed', 'cancelled', 'busy', 'ended', 'failed')),
  CONSTRAINT calls_not_self CHECK (caller_id <> callee_id)
);
CREATE INDEX IF NOT EXISTS calls_caller_idx ON public.calls (caller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_callee_idx ON public.calls (callee_id, created_at DESC);
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- You may call someone you share a conversation with, unless either of you blocked the other.
CREATE OR REPLACE FUNCTION public.can_call(target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND target IS NOT NULL AND target <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants a
      JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
      WHERE a.user_id = auth.uid() AND b.user_id = target)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = target) OR (blocker_id = target AND blocked_id = auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.can_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_call(uuid) TO authenticated;

REVOKE ALL ON public.calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.calls TO authenticated;
GRANT INSERT (callee_id, kind) ON public.calls TO authenticated;
GRANT UPDATE (status, answered_at, ended_at) ON public.calls TO authenticated;

DROP POLICY IF EXISTS calls_select ON public.calls;
CREATE POLICY calls_select ON public.calls FOR SELECT TO authenticated
  USING (auth.uid() IN (caller_id, callee_id));
DROP POLICY IF EXISTS calls_insert ON public.calls;
CREATE POLICY calls_insert ON public.calls FOR INSERT TO authenticated
  WITH CHECK (caller_id = auth.uid() AND status = 'ringing' AND public.can_call(callee_id));
DROP POLICY IF EXISTS calls_update ON public.calls;
CREATE POLICY calls_update ON public.calls FOR UPDATE TO authenticated
  USING (auth.uid() IN (caller_id, callee_id))
  WITH CHECK (auth.uid() IN (caller_id, callee_id));

-- Private broadcast inboxes `call:<user id>`: read your own, post to people you may call.
-- (realtime.messages only exists on Supabase; skipped elsewhere.)
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS pulse_call_inbox_read ON realtime.messages';
  EXECUTE $p$CREATE POLICY pulse_call_inbox_read ON realtime.messages FOR SELECT TO authenticated
    USING (realtime.messages.extension = 'broadcast' AND realtime.topic() = 'call:' || auth.uid()::text)$p$;
  EXECUTE 'DROP POLICY IF EXISTS pulse_call_inbox_send ON realtime.messages';
  EXECUTE $p$CREATE POLICY pulse_call_inbox_send ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK (realtime.messages.extension = 'broadcast'
      -- CASE so a topic that is not call:<uuid> never reaches the cast
      AND public.can_call(CASE WHEN realtime.topic() ~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               THEN substr(realtime.topic(), 6)::uuid END))$p$;
END $$;

NOTIFY pgrst, 'reload schema';
