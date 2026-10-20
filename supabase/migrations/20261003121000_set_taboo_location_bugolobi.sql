/*
# Set Taboo's location to Bugolobi

Explicitly sets the stored location for Taboo so the app displays Bugolobi.
The app renders `venues.location` as-is, so the database is the single source of truth.
Safe to re-run.
*/

UPDATE venues
SET location = 'Bugolobi'
WHERE lower(name) = 'taboo';
