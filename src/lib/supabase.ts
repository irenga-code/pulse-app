import { createClient } from '@supabase/supabase-js';
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
