#!/usr/bin/env bash
# Local runner for api_smoke.mjs: PostgreSQL + PostgREST + a tiny /rest/v1 proxy.
# Requires: postgres running with migrations applied (stubs in 00_supabase_stubs.sql),
# the `postgrest` binary on PATH (or POSTGREST=/path), and node >= 22.18.
# Usage: PGDATABASE_URI='postgresql://postgres@localhost:5432/pulse' supabase/tests/run_api_smoke.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SECRET="${JWT_SECRET:-pulse-local-test-secret-0123456789abcdef}"
URI="${PGDATABASE_URI:?set PGDATABASE_URI}"

psql "$URI" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-0000-0000-000000000001','alice@example.com','{"display_name":"alice_k"}'),
  ('a0000000-0000-0000-0000-000000000002','bob@example.com','{"display_name":"bob_b"}'),
  ('a0000000-0000-0000-0000-000000000003','mgr@example.com','{"display_name":"nomad_mgr"}'),
  ('a0000000-0000-0000-0000-000000000004','adm@example.com','{"display_name":"mod_one"}'),
  ('a0000000-0000-0000-0000-000000000005','carol@example.com',NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public.admins (user_id) VALUES ('a0000000-0000-0000-0000-000000000004') ON CONFLICT DO NOTHING;
INSERT INTO public.app_config (key, value) VALUES ('storage_base_url', 'https://proj.supabase.co') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('post-media', 'a0000000-0000-0000-0000-000000000001/clip.jpg'), ('post-media', 'a0000000-0000-0000-0000-000000000001/v.mp4'),
  ('post-media', 'a0000000-0000-0000-0000-000000000002/story.jpg') ON CONFLICT DO NOTHING;
-- vanish messages disappear 2 s after being read here (15 s in production) so the test does not have to wait long
INSERT INTO public.app_config (key, value) VALUES ('vanish_seconds', '2') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
UPDATE public.venues SET is_verified = true WHERE name = 'Nomad';
INSERT INTO public.venue_managers (venue_id, user_id, role)
  SELECT id, 'a0000000-0000-0000-0000-000000000003', 'owner' FROM public.venues WHERE name = 'Nomad' ON CONFLICT DO NOTHING;
SQL

PGRST_DB_URI="$URI" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
PGRST_SERVER_PORT=3000 "${POSTGREST:-postgrest}" >/tmp/postgrest.log 2>&1 &
PGRST_PID=$!
node -e '
const http=require("http");
http.createServer((req,res)=>{
  const p=http.request({host:"127.0.0.1",port:3000,method:req.method,path:req.url.replace(/^\/rest\/v1/,""),headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  p.on("error",e=>{res.writeHead(502);res.end(String(e))});req.pipe(p);
}).listen(3001);' &
PROXY_PID=$!
trap 'kill $PGRST_PID $PROXY_PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:3000/ && break; sleep 0.5; done
JWT_SECRET="$SECRET" node "$HERE/api_smoke.mjs"
