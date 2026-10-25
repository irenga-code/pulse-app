/*
# Pulse backend 17 — find people by phone number, including phone + password accounts

Idempotent. Apply after migration 15 (it replaces find_user_by_phone, same signature and grants).

Phone + password sign-up (development, no SMS provider) stores the account as an email address made from the number,
e.g. "+256789175095" -> "256789175095@pulseapp.com". Those numbers are not in profile_phones (that table only
holds numbers confirmed by SMS), so "New chat" by number could not find anyone who signed up that way.

- app_config 'phone_email_domains': comma-separated domains the app maps numbers to (VITE_PHONE_EMAIL_DOMAIN).
  Default 'pulseapp.com,pulse.internal.com,pulse.local' (pulseapp.com is a third party's domain: development only).
  Change it with:
    insert into public.app_config (key, value) values ('phone_email_domains', 'users.example.com')
    on conflict (key) do update set value = excluded.value;
- find_user_by_phone(p_phone): an SMS-confirmed number wins; otherwise a phone + password account whose mapped
  address matches. Still returns only the profile id (never the number or the address), only to signed-in active
  users, and never banned accounts.
  Note: mapped numbers are not verified, so anyone can sign up with any number this way. Development only.
*/

INSERT INTO public.app_config (key, value) VALUES ('phone_email_domains', 'pulseapp.com,pulse.internal.com,pulse.local')
ON CONFLICT (key) DO NOTHING;
-- databases that ran an earlier copy of this migration: add the current default domain
UPDATE public.app_config SET value = 'pulseapp.com,' || value
WHERE key = 'phone_email_domains' AND NOT ('pulseapp.com' = ANY (string_to_array(replace(value, ' ', ''), ',')));

CREATE OR REPLACE FUNCTION public.find_user_by_phone(p_phone text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  found uuid;
  digits text := public.normalize_phone(p_phone);
  domains text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'account is not active' USING ERRCODE = '42501'; END IF;
  IF digits IS NULL OR digits !~ '^[0-9]{7,15}$' THEN RETURN NULL; END IF;

  -- 1. confirmed by SMS
  SELECT pp.user_id INTO found
  FROM public.profile_phones pp JOIN public.profiles pr ON pr.id = pp.user_id
  WHERE pp.phone = digits AND pr.status <> 'banned';
  IF found IS NOT NULL THEN RETURN found; END IF;

  -- 2. phone + password account ("<digits>@<mapping domain>")
  SELECT coalesce(array_agg(lower(btrim(d))) FILTER (WHERE btrim(d) <> ''), '{}') INTO domains
  FROM unnest(string_to_array(coalesce((SELECT value FROM public.app_config WHERE key = 'phone_email_domains'), ''), ',')) AS d;
  IF cardinality(domains) = 0 THEN RETURN NULL; END IF;

  SELECT u.id INTO found
  FROM auth.users u JOIN public.profiles pr ON pr.id = u.id
  WHERE lower(u.email) = ANY (SELECT digits || '@' || d FROM unnest(domains) AS d)
    AND pr.status <> 'banned'
  ORDER BY u.created_at
  LIMIT 1;
  RETURN found;
END $$;

REVOKE EXECUTE ON FUNCTION public.find_user_by_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_phone(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
