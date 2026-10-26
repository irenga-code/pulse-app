/*
# Pulse backend 18 — keep phone numbers and real names out of the public profiles API

Idempotent. Apply after migration 15. No data is changed or deleted.

`profiles` is readable by everyone (signed out included) so names and photos can be shown. Some databases also have
hand-added columns such as `phone`, `phone_number` or `full_name` on it, which made those values public.
Pulse never reads them (numbers live privately in profile_phones / the account), so this switches profiles to
column-level read access: every column except those private ones stays readable.

Re-run this after adding columns to profiles: new columns only become readable once granted here.
*/
DO $$
DECLARE cols text; c text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name NOT IN ('phone', 'phone_number', 'full_name');
  -- PUBLIC too: a grant to PUBLIC would otherwise keep every column readable
  REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
  FOR c IN SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('phone', 'phone_number', 'full_name') LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.profiles FROM PUBLIC, anon, authenticated', c);
  END LOOP;
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO anon, authenticated', cols);
END $$;

NOTIFY pgrst, 'reload schema';
