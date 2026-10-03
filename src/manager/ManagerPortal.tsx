import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, AlertCircle, ArrowLeft, Loader2, LogOut, MapPin, Send } from 'lucide-react';
import { supabase, type Venue } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { VENUE_STATUSES, type VenueStatus } from '@/lib/venueStatus';

type AssignedVenue = Pick<Venue, 'id' | 'name' | 'location' | 'status'>;

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen w-full bg-wa-light dark:bg-wa-dark">
      <header className="bg-wa-lightHeader dark:bg-wa-darkPanel border-b border-wa-lightBorder dark:border-wa-darkBorder">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Activity className="w-5 h-5 text-wa-greenLight" strokeWidth={2.5} />
            <span className="text-white text-lg font-bold tracking-tight">Pulse</span>
            <span className="text-white/70 text-sm ml-2">Venue manager</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#/" className="flex items-center gap-1 text-white/90 text-sm">
              <ArrowLeft className="w-4 h-4" />
              Back to app
            </a>
            {onSignOut && (
              <button onClick={onSignOut} className="flex items-center gap-1 text-white/90 text-sm">
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

function LoginForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const message = await signIn(email.trim(), password);
    if (message) setError(message);
    setSubmitting(false);
  };

  const inputClass =
    'w-full bg-wa-lightPanel dark:bg-wa-darkSecondary text-wa-lightText dark:text-wa-darkText text-sm rounded-xl px-4 py-3 border border-wa-lightBorder dark:border-wa-darkBorder outline-none focus:ring-2 focus:ring-wa-green/40';

  return (
    <div className="max-w-sm mx-auto mt-10">
      <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Manager sign in</h1>
      <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-1">
        For venue managers and hosts. Update your venue's status and post updates.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={inputClass}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={inputClass}
        />
        {error && <p className="text-sm text-wa-live">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="bg-wa-green hover:bg-wa-greenDark text-white text-sm font-semibold rounded-xl py-3 transition-colors disabled:opacity-60"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function VenueManagerCard({
  venue,
  onStatusChange,
}: {
  venue: AssignedVenue;
  onStatusChange: (id: string, status: VenueStatus) => void;
}) {
  const [saving, setSaving] = useState<VenueStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setStatus = async (status: VenueStatus) => {
    if (status === venue.status) return;
    setSaving(status);
    setStatusError(null);
    const { data, error } = await supabase
      .from('venues')
      .update({ status })
      .eq('id', venue.id)
      .select('id, status');
    if (error || !data || data.length === 0) {
      setStatusError(error?.message ?? 'You are not allowed to update this venue.');
    } else {
      onStatusChange(venue.id, data[0].status as VenueStatus);
    }
    setSaving(null);
  };

  const publish = async (e: FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    setPosting(true);
    setPostMsg(null);
    const { error } = await supabase.from('posts').insert({
      user_name: venue.name,
      venue_id: venue.id,
      venue_name: venue.name,
      content: text,
    });
    if (error) {
      setPostMsg({ ok: false, text: error.message });
    } else {
      setContent('');
      setPostMsg({ ok: true, text: 'Posted to the community feed.' });
    }
    setPosting(false);
  };

  return (
    <div className="bg-wa-lightPanel dark:bg-wa-darkSecondary rounded-2xl p-4 border border-wa-lightBorder dark:border-wa-darkBorder">
      <h2 className="text-lg font-bold text-wa-lightText dark:text-wa-darkText">{venue.name}</h2>
      <div className="flex items-center gap-1 mt-0.5">
        <MapPin className="w-3.5 h-3.5 text-wa-lightTextSecondary dark:text-wa-darkTextSecondary" />
        <span className="text-xs text-wa-lightTextSecondary dark:text-wa-darkTextSecondary">
          {venue.location}
        </span>
      </div>

      <p className="text-xs font-semibold text-wa-lightTextSecondary dark:text-wa-darkTextSecondary uppercase tracking-wide mt-4 mb-2">
        Tonight's status
      </p>
      <div className="flex flex-wrap gap-2">
        {VENUE_STATUSES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            disabled={saving !== null}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 disabled:opacity-60 ${
              venue.status === s.id
                ? 'bg-wa-green text-white'
                : 'bg-wa-light dark:bg-wa-dark text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
            }`}
          >
            {saving === s.id ? 'Saving...' : s.label}
          </button>
        ))}
      </div>
      {statusError && <p className="text-xs text-wa-live mt-2">{statusError}</p>}

      <p className="text-xs font-semibold text-wa-lightTextSecondary dark:text-wa-darkTextSecondary uppercase tracking-wide mt-5 mb-2">
        Post an update
      </p>
      <form onSubmit={publish} className="flex flex-col gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="What's happening tonight?"
          className="w-full bg-wa-light dark:bg-wa-dark text-wa-lightText dark:text-wa-darkText text-sm rounded-xl px-4 py-3 border border-wa-lightBorder dark:border-wa-darkBorder outline-none focus:ring-2 focus:ring-wa-green/40 resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <span
            className={`text-xs ${
              postMsg?.ok === false ? 'text-wa-live' : 'text-wa-lightTextSecondary dark:text-wa-darkTextSecondary'
            }`}
          >
            {postMsg?.text ?? ''}
          </span>
          <button
            type="submit"
            disabled={posting || !content.trim()}
            className="flex items-center gap-1.5 bg-wa-green hover:bg-wa-greenDark text-white text-xs font-semibold rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" />
            {posting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [venues, setVenues] = useState<AssignedVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('venue_managers')
      .select('venues(id, name, location, status)');
    if (error) {
      setError(error.message);
    } else {
      const rows = (data ?? []) as unknown as { venues: AssignedVenue | AssignedVenue[] | null }[];
      const list = rows
        .flatMap((r) => (Array.isArray(r.venues) ? r.venues : r.venues ? [r.venues] : []))
        .sort((a, b) => a.name.localeCompare(b.name));
      setVenues(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, user?.id]);

  const handleStatusChange = (id: string, status: VenueStatus) =>
    setVenues((prev) => prev.map((v) => (v.id === id ? { ...v, status } : v)));

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-wa-green animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="w-10 h-10 text-wa-live" />
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-3 text-center">
          Could not load your venues. Please try again.
        </p>
      </div>
    );
  }

  if (venues.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-10 text-center">
        <h1 className="text-xl font-bold text-wa-lightText dark:text-wa-darkText">No venue assigned</h1>
        <p className="text-sm text-wa-lightTextSecondary dark:text-wa-darkTextSecondary mt-2">
          This account isn't linked to a venue yet. Ask a Pulse admin to assign you to your venue.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-wa-lightText dark:text-wa-darkText">Your venues</h1>
      {venues.map((v) => (
        <VenueManagerCard key={v.id} venue={v} onStatusChange={handleStatusChange} />
      ))}
    </div>
  );
}

export default function ManagerPortal() {
  const { user, loading, signOut } = useAuth();

  return (
    <Shell onSignOut={user ? signOut : undefined}>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-wa-green animate-spin" />
        </div>
      ) : user ? (
        <Dashboard />
      ) : (
        <LoginForm />
      )}
    </Shell>
  );
}
