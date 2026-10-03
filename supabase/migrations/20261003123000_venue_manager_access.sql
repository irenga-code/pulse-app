/*
# Venue manager access (foundation)

Regular visitors (anon / signed-in non-managers) can only READ venues and posts.
Venue managers/hosts sign in with Supabase Auth and, for the venues they are
assigned to, can:
- change that venue's `status` (and nothing else about the venue)
- publish and delete posts for that venue

## New table
- `venue_managers` (user_id -> auth.users, venue_id -> venues). A signed-in user can read
  only their own assignments. Assignments are created by an admin (SQL editor / service
  role); the app has no way to grant itself access.

## Security changes
- Removes the previous wide-open anon INSERT/UPDATE/DELETE policies on `venues` and `posts`.
- `venues`: public SELECT; UPDATE only for assigned managers, and column-level privileges
  limit what can be updated to `status`.
- `posts`: public SELECT; INSERT/DELETE only for assigned managers of the post's venue.
  `posts.author_id` (defaults to the signed-in user) is enforced to equal auth.uid().
- Table privileges are reset so anon can only SELECT. service_role (admin scripts,
  dashboard) is unaffected.

## Assigning a manager (run as admin)
1. Create the user in Supabase Dashboard > Authentication > Users.
2. Link them to a venue:
   INSERT INTO venue_managers (user_id, venue_id)
   SELECT u.id, v.id FROM auth.users u, venues v
   WHERE u.email = 'manager@example.com' AND v.name = 'Taboo';
*/

-- 1. Manager assignments --------------------------------------------------
CREATE TABLE IF NOT EXISTS venue_managers (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);

ALTER TABLE venue_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_read_own_assignments" ON venue_managers;
CREATE POLICY "managers_read_own_assignments"
ON venue_managers FOR SELECT
TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON venue_managers FROM anon, authenticated;
GRANT SELECT ON venue_managers TO authenticated;

-- 2. venues: public read, managers update status of their own venue -------
DROP POLICY IF EXISTS "anon_insert_venues" ON venues;
DROP POLICY IF EXISTS "anon_update_venues" ON venues;
DROP POLICY IF EXISTS "anon_delete_venues" ON venues;

DROP POLICY IF EXISTS "managers_update_own_venue" ON venues;
CREATE POLICY "managers_update_own_venue"
ON venues FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM venue_managers vm
    WHERE vm.venue_id = venues.id AND vm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM venue_managers vm
    WHERE vm.venue_id = venues.id AND vm.user_id = auth.uid()
  )
);

REVOKE ALL ON venues FROM anon, authenticated;
GRANT SELECT ON venues TO anon, authenticated;
GRANT UPDATE (status) ON venues TO authenticated;

-- 3. posts: public read, managers publish/delete for their own venue -----
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS author_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "anon_insert_posts" ON posts;
DROP POLICY IF EXISTS "anon_update_posts" ON posts;
DROP POLICY IF EXISTS "anon_delete_posts" ON posts;

DROP POLICY IF EXISTS "managers_insert_venue_posts" ON posts;
CREATE POLICY "managers_insert_venue_posts"
ON posts FOR INSERT
TO authenticated
WITH CHECK (
  venue_id IS NOT NULL
  AND author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM venue_managers vm
    WHERE vm.venue_id = posts.venue_id AND vm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "managers_delete_venue_posts" ON posts;
CREATE POLICY "managers_delete_venue_posts"
ON posts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM venue_managers vm
    WHERE vm.venue_id = posts.venue_id AND vm.user_id = auth.uid()
  )
);

REVOKE ALL ON posts FROM anon, authenticated;
GRANT SELECT ON posts TO anon, authenticated;
GRANT INSERT (user_name, venue_id, venue_name, content, author_id) ON posts TO authenticated;
GRANT DELETE ON posts TO authenticated;
