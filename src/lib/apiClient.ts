import { supabase } from './supabase';
import { createApi } from './api';

/** The app-wide API. All requests carry the signed-in user's JWT automatically. */
export const api = createApi(supabase);
