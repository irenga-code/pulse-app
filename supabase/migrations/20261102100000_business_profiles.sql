/*
# Pulse backend 21 — business profiles

Idempotent and additive.

- `business_profiles`: the WhatsApp Business-style details shown on a business account — cover photo, a short
  "What's happening?" note, description, address, coverage area, location notes, opening hours, category, up to two
  websites and the business email / phone. Name and photo stay on `profiles`.
- Everything here is meant for customers, so anyone may read it; only the owner can create or change their own row.
- `hours` is `{ "mode": "always" | "appointment" | "custom", "days": { "mon": { "open": true, "from": "09:00", "to": "17:00" }, ... } }`.
*/

CREATE TABLE IF NOT EXISTS public.business_profiles (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  cover_url text,
  status_text text,
  description text,
  address text,
  coverage_area text,
  location_notes text,
  hours jsonb,
  category text,
  websites text[] NOT NULL DEFAULT '{}',
  email text,
  phone text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_profiles_lengths CHECK (
    coalesce(length(status_text), 0) <= 139
    AND coalesce(length(description), 0) <= 512
    AND coalesce(length(address), 0) <= 256
    AND coalesce(length(coverage_area), 0) <= 128
    AND coalesce(length(location_notes), 0) <= 256
    AND coalesce(length(category), 0) <= 64
    AND coalesce(length(email), 0) <= 254
    AND coalesce(length(phone), 0) <= 32
    AND coalesce(length(cover_url), 0) <= 1024
  ),
  CONSTRAINT business_profiles_websites CHECK (
    cardinality(websites) <= 2 AND coalesce(length(array_to_string(websites, '')), 0) <= 512
  ),
  CONSTRAINT business_profiles_email CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT business_profiles_hours CHECK (hours IS NULL OR jsonb_typeof(hours) = 'object')
);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_profiles_select ON public.business_profiles;
CREATE POLICY business_profiles_select ON public.business_profiles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS business_profiles_insert ON public.business_profiles;
CREATE POLICY business_profiles_insert ON public.business_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS business_profiles_update ON public.business_profiles;
CREATE POLICY business_profiles_update ON public.business_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.business_profiles FROM anon, authenticated;
GRANT SELECT ON public.business_profiles TO anon, authenticated;
GRANT INSERT (user_id, cover_url, status_text, description, address, coverage_area, location_notes, hours, category, websites, email, phone)
  ON public.business_profiles TO authenticated;
GRANT UPDATE (cover_url, status_text, description, address, coverage_area, location_notes, hours, category, websites, email, phone)
  ON public.business_profiles TO authenticated;

/** updated_at is stamped by the server. */
CREATE OR REPLACE FUNCTION public.business_profiles_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.business_profiles_touch() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS business_profiles_touch ON public.business_profiles;
CREATE TRIGGER business_profiles_touch BEFORE INSERT OR UPDATE ON public.business_profiles
FOR EACH ROW EXECUTE FUNCTION public.business_profiles_touch();
