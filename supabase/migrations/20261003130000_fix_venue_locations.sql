/*
# Normalize the 8 confirmed Pulse venues

## Why
The original seed migration's header comment listed Taboo under Kololo and
"Governor" instead of "Guvnor". Databases seeded from earlier versions (or
edited by hand) can therefore disagree with the confirmed venue list. The
frontend renders `venues.location` verbatim, so the database is the single
source of truth for neighborhood tags.

## What this does (idempotent, safe to re-run)
For each confirmed venue, matched case-insensitively on name:
- updates name + location to the confirmed values (renames Governor -> Guvnor,
  Gaba Road -> Ggaba Road, Taboo -> Bugolobi)
- inserts the venue (status 'quiet') if it does not exist yet
Also updates the denormalized `posts.venue_name` for the Governor -> Guvnor rename.

## Confirmed list
Thrones - Bugolobi | Taboo - Bugolobi | Guvnor - Industrial Area
Black Panther - Kampala | Nomad - Ggaba Road | Paradigm - Ggaba Road
Catwalk - Kololo | Vanquish - Kololo
*/

DO $$
DECLARE
  r record;
BEGIN
  -- Keep denormalized post venue names in sync with the Governor -> Guvnor rename
  UPDATE posts SET venue_name = 'Guvnor'
  WHERE lower(btrim(venue_name)) = 'governor';

  FOR r IN
    SELECT * FROM (VALUES
      ('Thrones',       'Bugolobi'),
      ('Taboo',         'Bugolobi'),
      ('Guvnor',        'Industrial Area'),
      ('Black Panther', 'Kampala'),
      ('Nomad',         'Ggaba Road'),
      ('Paradigm',      'Ggaba Road'),
      ('Catwalk',       'Kololo'),
      ('Vanquish',      'Kololo')
    ) AS c(name, location)
  LOOP
    UPDATE venues
    SET name = r.name, location = r.location
    WHERE lower(btrim(name)) IN (lower(r.name), CASE WHEN r.name = 'Guvnor' THEN 'governor' ELSE lower(r.name) END)
      AND (name IS DISTINCT FROM r.name OR location IS DISTINCT FROM r.location);

    IF NOT EXISTS (
      SELECT 1 FROM venues
      WHERE lower(btrim(name)) = lower(r.name)
    ) THEN
      INSERT INTO venues (name, location, status) VALUES (r.name, r.location, 'quiet');
    END IF;
  END LOOP;
END $$;
