/** Shown instead of the app when .env has no Supabase settings (instead of a blank white page). */
export default function ConfigError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-wa-dark p-6">
      <div className="max-w-md w-full rounded-2xl bg-wa-darkSecondary border border-wa-darkBorder p-6 text-wa-darkText">
        <h1 className="text-lg font-bold">Pulse needs its Supabase settings</h1>
        <p className="text-sm mt-2 text-wa-darkTextSecondary">
          The <code>.env</code> file is missing or incomplete. In the project folder run:
        </p>
        <pre className="mt-3 rounded-xl bg-wa-dark p-3 text-xs overflow-x-auto">cp .env.example .env</pre>
        <p className="text-sm mt-3 text-wa-darkTextSecondary">
          Then fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Supabase dashboard,
          Settings, API) and restart <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}
