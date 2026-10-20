-- READ-ONLY: describes the structure of the public schema (tables, columns, constraints, views, functions,
-- triggers, policies, indexes, approximate row counts). It reads no rows of your data and changes nothing.
-- Run it in the Supabase SQL Editor, then download the result (one cell, JSON).
SELECT json_build_object(
  'generated_at', now(),
  'columns', (SELECT json_agg(json_build_object('t', table_name, 'c', column_name, 'type', udt_name, 'nullable', is_nullable,
                                                 'default', column_default) ORDER BY table_name, ordinal_position)
              FROM information_schema.columns WHERE table_schema = 'public'),
  'relations', (SELECT json_agg(json_build_object('name', c.relname, 'kind', c.relkind, 'approx_rows', c.reltuples::bigint,
                                                   'rls', c.relrowsecurity) ORDER BY c.relname)
                FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p')),
  'constraints', (SELECT json_agg(json_build_object('t', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid))
                                  ORDER BY conrelid::regclass::text, conname)
                  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0),
  'views', (SELECT json_agg(json_build_object('name', viewname, 'def', definition) ORDER BY viewname) FROM pg_views WHERE schemaname = 'public'),
  'view_deps', (SELECT json_agg(DISTINCT jsonb_build_object('view', v.relname, 'uses', s.relname))
                FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid JOIN pg_class v ON v.oid = rw.ev_class
                JOIN pg_class s ON s.oid = d.refobjid
                WHERE v.relnamespace = 'public'::regnamespace AND s.relnamespace = 'public'::regnamespace AND v.oid <> s.oid),
  'functions', (SELECT json_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid)
                                ORDER BY p.proname)
                FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')),
  'triggers', (SELECT json_agg(json_build_object('t', tgrelid::regclass::text, 'name', tgname, 'enabled', tgenabled) ORDER BY tgrelid::regclass::text, tgname)
               FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)),
  'policies', (SELECT json_agg(json_build_object('t', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles) ORDER BY tablename, policyname)
               FROM pg_policies WHERE schemaname = 'public'),
  'indexes', (SELECT json_agg(json_build_object('t', tablename, 'name', indexname, 'def', indexdef) ORDER BY tablename, indexname)
              FROM pg_indexes WHERE schemaname = 'public'),
  'enums', (SELECT json_agg(t.typname) FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'),
  'realtime', (SELECT json_agg(tablename) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'),
  'storage_buckets', (SELECT json_agg(id) FROM storage.buckets),
  'extensions', (SELECT json_agg(extname) FROM pg_extension)
) AS schema_report;
