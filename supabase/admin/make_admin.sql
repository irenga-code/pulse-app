-- Make a Pulse user an administrator (admin dashboard at /admin or /#/manage: reports, users, verifications).
-- Run in the Supabase SQL Editor, which has full rights. The app itself can never grant this:
-- admin status is a row in public.admins, checked by the database on every admin action.
--
-- 1. Sign up in the app with the account first (and confirm the email if confirmation is on).
-- 2. Put that account's email below and run this.
-- 3. Reload the app (or sign out and in again) so it re-checks.
--
-- To remove an admin later:
--   DELETE FROM public.admins WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('YOU@EXAMPLE.COM'));

DO $$
DECLARE
  target_email text := 'YOU@EXAMPLE.COM';
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(target_email);
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No Pulse account with email %. Sign up in the app first, then run this again.', target_email;
  END IF;
  INSERT INTO public.admins (user_id) VALUES (uid) ON CONFLICT (user_id) DO NOTHING;
END $$;

-- Everyone who is an administrator now:
SELECT u.email, p.display_name, a.created_at AS admin_since
FROM public.admins a
JOIN auth.users u ON u.id = a.user_id
LEFT JOIN public.profiles p ON p.id = a.user_id
ORDER BY a.created_at;
