/*
# Pulse backend 20 — chat list actions: pin chat, mark as unread, block

Idempotent and additive. Apply after migration 15.

- `conversation_participants.is_pinned` / `pinned_at`: your pinned chats stay on top of your list (up to 3, like
  WhatsApp). `marked_unread`: "Mark as unread" — cleared when you open the chat. Only you see or change your row.
- `user_blocks`: you block someone; neither of you can send the other messages while the block stands (the sender
  just sees "unavailable"), and you can unblock at any time. Only the blocker sees the block.
*/

-- ============================================================================
-- Pinned chats + mark as unread
-- ============================================================================
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS marked_unread boolean NOT NULL DEFAULT false;
GRANT UPDATE (is_pinned, pinned_at, marked_unread) ON public.conversation_participants TO authenticated;

/** At most 3 pinned chats per person; pinned_at is stamped by the server. */
CREATE OR REPLACE FUNCTION public.participants_pin_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_pinned AND NOT OLD.is_pinned THEN
    IF (SELECT count(*) FROM public.conversation_participants
        WHERE user_id = NEW.user_id AND is_pinned AND conversation_id <> NEW.conversation_id) >= 3 THEN
      RAISE EXCEPTION 'you can only pin up to 3 chats' USING ERRCODE = '54000';
    END IF;
    NEW.pinned_at := now();
  ELSIF NOT NEW.is_pinned THEN
    NEW.pinned_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_pin_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS participants_pin_guard ON public.conversation_participants;
CREATE TRIGGER participants_pin_guard BEFORE UPDATE OF is_pinned ON public.conversation_participants
FOR EACH ROW EXECUTE FUNCTION public.participants_pin_guard();

-- ============================================================================
-- Blocking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_blocks_select ON public.user_blocks;
CREATE POLICY user_blocks_select ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
DROP POLICY IF EXISTS user_blocks_insert ON public.user_blocks;
CREATE POLICY user_blocks_insert ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
DROP POLICY IF EXISTS user_blocks_delete ON public.user_blocks;
CREATE POLICY user_blocks_delete ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());
REVOKE ALL ON public.user_blocks FROM anon, authenticated;
GRANT SELECT, DELETE ON public.user_blocks TO authenticated;
GRANT INSERT (blocked_id) ON public.user_blocks TO authenticated;

/** No messages in either direction while one of the two has blocked the other. */
CREATE OR REPLACE FUNCTION public.messages_check_block()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NEW.kind = 'system' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    JOIN public.user_blocks b ON (b.blocker_id = uid AND b.blocked_id = cp.user_id) OR (b.blocker_id = cp.user_id AND b.blocked_id = uid)
    WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> uid
  ) THEN
    RAISE EXCEPTION 'recipient unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.messages_check_block() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_check_block ON public.messages;
CREATE TRIGGER messages_check_block BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.messages_check_block();

NOTIFY pgrst, 'reload schema';
