import { createClient } from '@supabase/supabase-js';
<<<<<<< HEAD
import { createResilientFetch } from './resilientFetch';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when .env is missing/empty. main.tsx then shows a setup screen instead of a blank page. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// A placeholder keeps module loading from crashing; the app never talks to it when unconfigured.
export const supabase = createClient(supabaseUrl || 'http://localhost:54321', supabaseAnonKey || 'missing-anon-key', {
  auth: {
    // PKCE puts the recovery/confirmation code in the query string, which keeps the
    // URL hash free for the /#/manage route.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // 5 s timeout + backoff retries for reads, so a dropped connection recovers instead of hanging
  global: { fetch: createResilientFetch((...args) => fetch(...args)) },
});

export type {
  Venue, Post, Comment, Profile, PublicProfile, Preferences, AppNotification,
} from './types';
=======
import type { VenueStatus } from '@/lib/venueStatus';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Venue = {
  id: string;
  name: string;
  location: string;
  status: VenueStatus;
  image_url: string | null;
  created_at: string;
};

export type Post = {
  id: string;
  user_name: string;
  venue_id: string | null;
  venue_name: string | null;
  author_id: string | null;
  content: string;
  likes: number;
  comments: number;
  created_at: string;
};
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
