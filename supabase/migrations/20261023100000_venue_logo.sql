/*
# Pulse backend 11 — venue logo

Idempotent and additive. Apply after migration 10.

- venues.logo_url: a square logo / profile picture, next to the existing `image_url` cover photo. Like
  `image_url` (migration 8) it must be an http(s) URL.
- Linked hosts/managers and admins edit it through the same `venues_update_managers` policy as the rest of the
  venue profile (migration 9; `manages_venue()` includes admins).
- venues_public exposes it as its last column (CREATE OR REPLACE VIEW can only add columns at the end); the
  rest of the view is unchanged from migration 7.
*/

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS logo_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.venues'::regclass AND conname = 'venues_logo_url_ck') THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_logo_url_ck CHECK (logo_url IS NULL OR logo_url ~* '^https?://');
  END IF;
END $$;

GRANT UPDATE (logo_url) ON public.venues TO authenticated;

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
                AND e.starts_at <= now() AND now() <= coalesce(e.ends_at, e.starts_at + interval '6 hours')))) AS is_live,
       v.logo_url
FROM v;

NOTIFY pgrst, 'reload schema';
