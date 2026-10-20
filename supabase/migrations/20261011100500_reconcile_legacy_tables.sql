/*
# Pulse backend 1b — bring pre-existing tables up to the shape migration 2 expects

Idempotent. Apply after migration 1 and before `20261011101000_backend_community.sql`.

Some projects already have `comments`, `reviews`, `reports`, `venue_follows` or `notification_reads` from an
earlier build, with different columns. Migration 2 creates those tables with `CREATE TABLE IF NOT EXISTS`, so it
skips them and then fails on missing columns (e.g. `column "target_type" does not exist`).

- `reports` without `target_type` cannot be mapped (no target to point at): it is renamed to `reports_legacy`
  (rows kept, locked to the service role) and migration 2 creates a fresh `reports`.
- The other tables keep their rows: missing columns are added (author names backfilled from `profiles`), stray
  NOT NULL columns the app never fills are relaxed, old CHECK constraints and policies are replaced by the ones
  migration 2 defines.

On a database that never had these tables this does nothing.
*/

-- reports: an old shape is set aside --------------------------------------------------------------
DO $$
DECLARE ix record;
BEGIN
  IF to_regclass('public.reports') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'target_type') THEN
    IF to_regclass('public.reports_legacy') IS NOT NULL THEN
      RAISE EXCEPTION 'public.reports has an old shape and public.reports_legacy already exists; rename or drop one of them first';
    END IF;
    ALTER TABLE public.reports RENAME TO reports_legacy;
    -- index names are schema-wide: free reports_pkey etc. for the new table
    FOR ix IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
              WHERE i.indrelid = 'public.reports_legacy'::regclass AND c.relname NOT LIKE '%\_legacy' LOOP
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', ix.relname, left(ix.relname, 56) || '_legacy');
    END LOOP;
    REVOKE ALL ON public.reports_legacy FROM anon, authenticated;
    ALTER TABLE public.reports_legacy ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'old public.reports renamed to public.reports_legacy';
  END IF;
END $$;

-- missing columns -----------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    ALTER TABLE public.comments
      ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'visible',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    ALTER TABLE public.reviews
      ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS body text,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'visible',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.venue_follows') IS NOT NULL THEN
    ALTER TABLE public.venue_follows ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF to_regclass('public.notification_reads') IS NOT NULL THEN
    ALTER TABLE public.notification_reads ADD COLUMN IF NOT EXISTS read_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- comments/reviews text that lived under another column name ---------------------------------------
DO $$
DECLARE t text; src text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comments', 'reviews'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'body') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN body text', t);
    END IF;
    SELECT column_name INTO src FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = t AND column_name IN ('content', 'comment', 'text', 'message')
    ORDER BY array_position(ARRAY['content', 'comment', 'text', 'message'], column_name::text) LIMIT 1;
    IF src IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET body = %I WHERE body IS NULL AND %I IS NOT NULL', t, src, src);
    END IF;
  END LOOP;
  -- a comment always has text
  IF to_regclass('public.comments') IS NOT NULL THEN
    UPDATE public.comments SET body = '(empty)' WHERE body IS NULL OR btrim(body) = '';
    ALTER TABLE public.comments ALTER COLUMN body SET NOT NULL;
  END IF;
END $$;

-- author names (later rows are stamped by migration 2's triggers) ----------------------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    UPDATE public.comments c SET user_name = p.display_name FROM public.profiles p WHERE p.id = c.user_id AND c.user_name = '';
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    UPDATE public.reviews r SET user_name = p.display_name FROM public.profiles p WHERE p.id = r.user_id AND r.user_name = '';
  END IF;
END $$;

-- stray NOT NULL columns, old CHECK constraints and old policies ------------------------------------
DO $$
DECLARE
  -- columns migration 2 (or later) defines; anything else NOT NULL without a default would break the app's inserts
  expected jsonb := '{
    "comments": ["id", "post_id", "user_id", "user_name", "body", "status", "created_at", "updated_at"],
    "reviews": ["id", "venue_id", "user_id", "user_name", "rating", "body", "status", "created_at", "updated_at"],
    "venue_follows": ["user_id", "venue_id", "created_at"],
    "notification_reads": ["user_id", "notification_id", "read_at"]
  }';
  t text; r record;
BEGIN
  FOR t IN SELECT jsonb_object_keys(expected) LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    FOR r IN SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = t AND is_nullable = 'NO' AND column_default IS NULL
               AND NOT (expected -> t) ? column_name LOOP
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', t, r.column_name);
    END LOOP;
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND contype = 'c' LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, r.conname);
    END LOOP;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- the CHECKs migration 2 would have created (NOT VALID: old rows are not re-checked) ---------------------
DO $$
BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    ALTER TABLE public.comments ADD CONSTRAINT comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 500) NOT VALID;
    ALTER TABLE public.comments ADD CONSTRAINT comments_status_check CHECK (status IN ('visible', 'removed')) NOT VALID;
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5) NOT VALID;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_body_check CHECK (body IS NULL OR char_length(body) <= 1000) NOT VALID;
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_status_check CHECK (status IN ('visible', 'removed')) NOT VALID;
  END IF;
END $$;
