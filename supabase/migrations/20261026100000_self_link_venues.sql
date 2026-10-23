/*
# Pulse backend 14 — hosts and venue accounts link themselves to venues

Idempotent and additive. Apply after migration 13. No existing policy is changed (vm_select and vm_admin_write stay).

- `vm_self_insert`: an active user whose account role is Performer / Staff ('host') or Venue account ('venue') can
  insert their own venue_managers row, for any number of venues, with no admin approval:
      insert into venue_managers (venue_id, user_id) values (<venue>, auth.uid())
  The row must be their own (user_id = auth.uid()) and its role 'manager' (the default) or 'host', never 'owner'.
  Account roles are only given by verification or an admin (users can not update profiles.account_type), so plain
  users, suspended and banned accounts can not link themselves. Leaving stays with leave_venue (migration 13).
*/

DROP POLICY IF EXISTS vm_self_insert ON public.venue_managers;
CREATE POLICY vm_self_insert ON public.venue_managers FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role IN ('manager', 'host')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status = 'active' AND p.account_type IN ('host', 'venue')
    )
  );

NOTIFY pgrst, 'reload schema';
