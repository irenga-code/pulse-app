/*
# Venue statuses: Live, Sold Out, Not Active

Replaces the old status set ('live', 'busy', 'quiet') with:
- `live`       — the club is open and running tonight
- `sold_out`   — the club is running but sold out
- `not_active` — the club did not operate / is not running tonight

## Data migration
Any row whose status is not one of the three new values (i.e. legacy 'busy' / 'quiet')
becomes `not_active`. This is deliberately neutral: it never claims a venue is live or
sold out. Venue managers set the real status after signing in.

## Changes
- Default status is now `not_active`.
- A CHECK constraint restricts `status` to the three allowed values.
*/

UPDATE venues
SET status = 'not_active'
WHERE status NOT IN ('live', 'sold_out', 'not_active');

ALTER TABLE venues ALTER COLUMN status SET DEFAULT 'not_active';

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_status_check;
ALTER TABLE venues
  ADD CONSTRAINT venues_status_check
  CHECK (status IN ('live', 'sold_out', 'not_active'));
