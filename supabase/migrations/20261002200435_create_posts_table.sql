/*
# Create posts table for community feed

## Overview
Creates the `posts` table to store real user community updates about Kampala nightlife venues.
This is a single-tenant app with no authentication — all data is intentionally public/shared.

## New Tables
- `posts`
  - `id` (uuid, primary key, auto-generated)
  - `user_name` (text, not null) — display name of the poster
  - `venue_id` (uuid, nullable, references venues) — optional link to a venue
  - `venue_name` (text, nullable) — denormalized venue name for convenience
  - `content` (text, not null) — the post message
  - `likes` (integer, not null, default 0) — like count
  - `comments` (integer, not null, default 0) — comment count
  - `created_at` (timestamptz, default now()) — when the post was created

## Security
- Enables RLS on `posts`.
- Adds 4 policies (SELECT, INSERT, UPDATE, DELETE) for anon + authenticated roles
  since the data is intentionally public and there is no sign-in flow.
*/

CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  venue_name text,
  content text NOT NULL,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_posts" ON posts;
CREATE POLICY "anon_select_posts"
ON posts FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_posts" ON posts;
CREATE POLICY "anon_insert_posts"
ON posts FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_posts" ON posts;
CREATE POLICY "anon_update_posts"
ON posts FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_posts" ON posts;
CREATE POLICY "anon_delete_posts"
ON posts FOR DELETE
TO anon, authenticated USING (true);
