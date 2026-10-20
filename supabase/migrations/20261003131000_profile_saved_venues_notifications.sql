/*
# Profile tab: saved venues + notifications

## New Tables
- `saved_venues` — bookmarks. The app has no sign-in flow yet, so rows are keyed
  by an anonymous per-device id (`device_id`, generated client-side) instead of a
  user id. Swap `device_id` for `auth.uid()` when real auth lands.
  - unique (device_id, venue_id); cascades when a venue is deleted
- `notifications` — broadcast alerts shown in Profile > Notifications.
  Read/unread state is kept per device in the browser, not in this table.
  - `type`: 'venue_live' | 'community' | 'system'

## Automation
- Trigger `venues_notify_live`: when a venue's status changes to 'live', a
  'venue_live' notification is inserted automatically.

## Security
- RLS enabled on both tables.
- saved_venues: anon + authenticated may SELECT / INSERT / DELETE
  (same "intentionally public, no auth yet" model as venues and posts).
- notifications: anon + authenticated may SELECT only. Rows are created by the
  trigger above or from the Supabase dashboard / service role.

## Realtime
- `notifications` is added to the supabase_realtime publication so new alerts
  appear without a reload.
*/

-- saved_venues -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 64),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, venue_id)
);

CREATE INDEX IF NOT EXISTS saved_venues_device_idx ON saved_venues (device_id);

ALTER TABLE saved_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_saved_venues" ON saved_venues;
CREATE POLICY "anon_select_saved_venues"
ON saved_venues FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_saved_venues" ON saved_venues;
CREATE POLICY "anon_insert_saved_venues"
ON saved_venues FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_saved_venues" ON saved_venues;
CREATE POLICY "anon_delete_saved_venues"
ON saved_venues FOR DELETE
TO anon, authenticated USING (true);

-- notifications ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'system' CHECK (type IN ('venue_live', 'community', 'system')),
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications"
ON notifications FOR SELECT
TO anon, authenticated USING (true);

-- Seed a few starter notifications (only if the table is empty)
INSERT INTO notifications (title, body, type, created_at)
SELECT * FROM (VALUES
  ('Welcome to Pulse', 'Real-time nightlife across Kampala. Check Tonight to see what is live right now.', 'system', now() - interval '3 hours'),
  ('Save your favourite spots', 'Tap the bookmark on any venue to keep it in Profile > Saved venues.', 'system', now() - interval '2 hours'),
  ('See what Kampala is saying', 'The Community tab is where people post live updates from venues.', 'community', now() - interval '1 hour')
) AS n(title, body, type, created_at)
WHERE NOT EXISTS (SELECT 1 FROM notifications LIMIT 1);

-- Auto-alert when a venue goes live -------------------------------------------
CREATE OR REPLACE FUNCTION notify_venue_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN
    INSERT INTO notifications (title, body, type, venue_id)
    VALUES (
      NEW.name || ' is live now',
      'Things are picking up in ' || NEW.location || '. Head over!',
      'venue_live',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS venues_notify_live ON venues;
CREATE TRIGGER venues_notify_live
AFTER UPDATE OF status ON venues
FOR EACH ROW EXECUTE FUNCTION notify_venue_live();

-- Realtime ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
