/*
# Pulse backend 22 — promotions (free, native campaigns)

Idempotent and additive.

- `promotions`: a business's campaign from Business tools > Advertise — description, an optional photo / video, where
  it shows (`placements`: feed, status, directory), who it is for (`audience`), special-topic flags and how long it
  runs. Promotions are free: there is no budget or payment.
- `duration_days` is 1, 3 or 7, or NULL for a continuous campaign; the server stamps `starts_at` and works out
  `ends_at` from it, so a client can not extend a campaign by sending its own dates.
- Anyone can read a campaign that is running (active and not past its end), so Pulse can show it; owners also see
  their own past and paused ones. Owners may pause / resume (`status`) and delete their campaigns.
*/

CREATE TABLE IF NOT EXISTS public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  description text,
  media_url text,
  media_type text,
  placements text[] NOT NULL,
  audience jsonb NOT NULL DEFAULT '{"suggested": true}',
  special_categories text[] NOT NULL DEFAULT '{}',
  duration_days int,
  status text NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_content CHECK (coalesce(length(trim(description)), 0) > 0 OR media_url IS NOT NULL),
  CONSTRAINT promotions_description CHECK (coalesce(length(description), 0) <= 500),
  CONSTRAINT promotions_media CHECK ((media_url IS NULL) = (media_type IS NULL) AND (media_type IS NULL OR media_type IN ('image', 'video'))),
  CONSTRAINT promotions_media_url CHECK (coalesce(length(media_url), 0) <= 1024),
  CONSTRAINT promotions_placements CHECK (cardinality(placements) BETWEEN 1 AND 3 AND placements <@ ARRAY['feed', 'status', 'directory']),
  CONSTRAINT promotions_special CHECK (special_categories <@ ARRAY['Credit', 'Employment', 'Housing', 'Social issues, elections or politics']),
  CONSTRAINT promotions_audience CHECK (jsonb_typeof(audience) = 'object' AND length(audience::text) <= 1000),
  CONSTRAINT promotions_duration CHECK (duration_days IS NULL OR duration_days IN (1, 3, 7)),
  CONSTRAINT promotions_status CHECK (status IN ('active', 'paused'))
);
CREATE INDEX IF NOT EXISTS promotions_user_idx ON public.promotions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promotions_running_idx ON public.promotions (status, ends_at);

/** The server owns the timing: start now, end after duration_days (never for a continuous campaign). */
CREATE OR REPLACE FUNCTION public.promotions_timing()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.starts_at := now();
    NEW.created_at := now();
  ELSE
    NEW.starts_at := OLD.starts_at;
    NEW.created_at := OLD.created_at;
    NEW.duration_days := OLD.duration_days;
  END IF;
  NEW.ends_at := CASE WHEN NEW.duration_days IS NULL THEN NULL ELSE NEW.starts_at + make_interval(days => NEW.duration_days) END;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.promotions_timing() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS promotions_timing ON public.promotions;
CREATE TRIGGER promotions_timing BEFORE INSERT OR UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.promotions_timing();

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotions_select ON public.promotions;
CREATE POLICY promotions_select ON public.promotions FOR SELECT TO anon, authenticated
  USING ((status = 'active' AND (ends_at IS NULL OR ends_at > now())) OR user_id = auth.uid());
DROP POLICY IF EXISTS promotions_insert ON public.promotions;
CREATE POLICY promotions_insert ON public.promotions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS promotions_update ON public.promotions;
CREATE POLICY promotions_update ON public.promotions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS promotions_delete ON public.promotions;
CREATE POLICY promotions_delete ON public.promotions FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.promotions FROM anon, authenticated;
GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT INSERT (description, media_url, media_type, placements, audience, special_categories, duration_days) ON public.promotions TO authenticated;
GRANT UPDATE (status) ON public.promotions TO authenticated;
GRANT DELETE ON public.promotions TO authenticated;
