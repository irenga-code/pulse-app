/*
# Pulse backend 6 — performer / staff roles on verification requests

Idempotent. Apply after migrations 1-5.

- `verification_requests.role`: what a 'host' (Performer / Staff) request is for:
  Manager, Host, Mc, Dj, Promoter, Musician, Dancer (exact spelling, shown as-is in the app).
- New 'host' requests must name a role; requests made before this migration keep role NULL (constraint is NOT VALID).
  Venue requests carry no role.
- The approval notification names the role ("Your Mc account is now verified.").
*/

ALTER TABLE public.verification_requests ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.verification_requests DROP CONSTRAINT IF EXISTS verification_role_ck;
ALTER TABLE public.verification_requests ADD CONSTRAINT verification_role_ck CHECK (
  CASE kind
    -- coalesce: NULL IN (...) is NULL, which a CHECK would let through
    WHEN 'host' THEN coalesce(role IN ('Manager', 'Host', 'Mc', 'Dj', 'Promoter', 'Musician', 'Dancer'), false)
    ELSE role IS NULL
  END
) NOT VALID;

GRANT INSERT (role) ON public.verification_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_verification(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS public.verification_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.verification_requests;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;

  SELECT * INTO r FROM public.verification_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already reviewed' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.verification_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(), reviewed_at = now(), note = p_note
  WHERE id = p_request_id RETURNING * INTO r;

  IF p_approve THEN
    UPDATE public.profiles SET account_type = r.kind, is_verified = true WHERE id = r.user_id;
    IF r.kind = 'venue' THEN
      INSERT INTO public.venue_managers (venue_id, user_id, role) VALUES (r.venue_id, r.user_id, 'owner')
      ON CONFLICT DO NOTHING;
      UPDATE public.venues SET is_verified = true WHERE id = r.venue_id;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (r.user_id, 'system',
          CASE WHEN p_approve THEN 'Verification approved' ELSE 'Verification not approved' END,
          CASE WHEN p_approve THEN 'Your ' || coalesce(r.role, r.kind) || ' account is now verified.'
               ELSE coalesce(nullif(p_note, ''), 'Your request was not approved this time.') END);

  PERFORM public.log_admin_action(CASE WHEN p_approve THEN 'approve_verification' ELSE 'reject_verification' END,
                                  'verification_request', r.id, p_note);
  RETURN r;
END $$;

NOTIFY pgrst, 'reload schema';
