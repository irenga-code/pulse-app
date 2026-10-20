/*
# Pulse backend 7 — `is_live` on venues_public

Idempotent. Apply after migrations 1-6.

`venues.status` (set with `set_venue_status`, by a venue's managers or an admin) stays the single source of truth.
`venues_public.is_live` is derived from it, so it can never disagree with the status or outlive its expiry:
- true when the venue's effective status is 'live' (not expired), or
- when a published event at the venue is running now (same window as `events_feed.phase = 'live_now'`),
  unless the venue is marked 'sold_out'.

`events` joins the realtime publication so an event starting or being cancelled refreshes the app too
(the app also re-checks every minute, which covers start and end times passing).
*/

CREATE OR REPLACE VIEW public.venues_public WITH (security_invoker = true) AS
WITH v AS (
  SELECT v.*,
         CASE WHEN v.status IN ('live', 'sold_out') AND v.status_expires_at IS NOT NULL AND v.status_expires_at <= now()
              THEN 'not_active' ELSE v.status END AS effective_status
  FROM public.venues v
)
SELECT v.id, v.name, v.slug, v.location, v.address, v.description, v.image_url,
       v.latitude, v.longitude, v.phone, v.whatsapp, v.is_verified, v.created_at,
       v.effective_status AS status,
       CASE WHEN v.effective_status = 'not_active' THEN NULL ELSE v.status_expires_at END AS status_expires_at,
       v.status_updated_at,
       (v.effective_status = 'live'
        OR (v.effective_status <> 'sold_out' AND EXISTS (
              SELECT 1 FROM public.events e
              WHERE e.venue_id = v.id AND e.status = 'published'
                AND e.starts_at <= now() AND now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours')))) AS is_live
FROM v;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
