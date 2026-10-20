/*
# Pulse backend — pre-deployment security hardening

- posts: authors could UPDATE `media_url` after posting. The own-folder / file-exists rules in `posts_prepare()`
  only run on INSERT, so an edit could point a post (or snap) at any external URL (tracking pixel, swapped
  image). The app never edits posts, so authors may now only edit `content`.
- venues.image_url, events.cover_image_url, events.ticket_url: no format check, so a venue manager could store
  `javascript:` / `data:` URLs. They must now be http(s) URLs; existing values that are not are set to NULL.

Idempotent.
*/

-- ============================================================================
-- posts: content is the only editable column
-- ============================================================================
REVOKE UPDATE ON public.posts FROM anon, authenticated;
GRANT UPDATE (content) ON public.posts TO authenticated;

-- ============================================================================
-- URL columns written by venue managers
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('venues', 'image_url', 'venues_image_url_ck'),
      ('events', 'cover_image_url', 'events_cover_image_url_ck'),
      ('events', 'ticket_url', 'events_ticket_url_ck')) v(t, c, name) LOOP
    CONTINUE WHEN to_regclass('public.' || r.t) IS NULL;
    -- a NOT VALID check still applies to every later UPDATE of the row (e.g. set_venue_status), so a value that
    -- would fail it (written while the table was still open to anon) is cleared first; it could not render anyway
    EXECUTE format($f$UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL AND %I !~* '^https?://'$f$, r.t, r.c, r.c, r.c);
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || r.t)::regclass AND conname = r.name);
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I ~* '^https?://') NOT VALID$f$,
                   r.t, r.name, r.c, r.c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
