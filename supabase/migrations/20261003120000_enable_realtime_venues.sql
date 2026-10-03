/*
# Enable realtime on venues

Adds `venues` to the `supabase_realtime` publication so the app's
postgres_changes subscription receives inserts, updates and deletes.
Safe to re-run.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'venues'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venues;
  END IF;
END $$;
