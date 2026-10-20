/*
# Create venues table for Pulse nightlife app

## Overview
Creates the `venues` table to store Kampala nightlife venues. This is a single-tenant
app with no authentication — all data is intentionally public/shared.

## New Tables
- `venues`
  - `id` (uuid, primary key, auto-generated)
  - `name` (text, not null) — venue display name
  - `location` (text, not null) — neighborhood/area description
  - `status` (text, not null, default 'quiet') — current live status: 'live', 'busy', 'quiet'
  - `image_url` (text) — optional URL to venue photo
  - `created_at` (timestamptz, default now()) — when the venue was added

## Seed Data
Inserts 8 default Kampala venues:
- Nomad (Gaba Road), Paradigm (Gaba Road), Thrones (Bugolobi), Catwalk (Kololo),
  Vanquish (Kololo), Governor (Industrial Area), Black Panther (Kampala), Taboo (Kololo)

## Security
- Enables RLS on `venues`.
- Adds 4 policies (SELECT, INSERT, UPDATE, DELETE) for anon + authenticated roles
  since the data is intentionally public and there is no sign-in flow.
*/

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL,
  status text NOT NULL DEFAULT 'quiet',
  image_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_venues" ON venues;
CREATE POLICY "anon_select_venues"
ON venues FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_venues" ON venues;
CREATE POLICY "anon_insert_venues"
ON venues FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_venues" ON venues;
CREATE POLICY "anon_update_venues"
ON venues FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_venues" ON venues;
CREATE POLICY "anon_delete_venues"
ON venues FOR DELETE
TO anon, authenticated USING (true);

-- Seed default Kampala venues (only if table is empty)
INSERT INTO venues (name, location, status, image_url)
SELECT * FROM (VALUES
  ('Nomad', 'Gaba Road', 'live', NULL),
  ('Paradigm', 'Gaba Road', 'busy', NULL),
  ('Thrones', 'Bugolobi', 'quiet', NULL),
  ('Catwalk', 'Kololo', 'live', NULL),
  ('Vanquish', 'Kololo', 'quiet', NULL),
  ('Governor', 'Industrial Area', 'busy', NULL),
  ('Black Panther', 'Kampala', 'quiet', NULL),
  ('Taboo', 'Bugolobi', 'live', NULL)
) AS v(name, location, status, image_url)
WHERE NOT EXISTS (SELECT 1 FROM venues LIMIT 1);
