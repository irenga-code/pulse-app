import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
<<<<<<< HEAD
import ConfigError from './components/ConfigError.tsx';
import { isSupabaseConfigured } from './lib/supabase';
import { hashFromPath } from './hooks/useHashRoute';
import './index.css';

hashFromPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSupabaseConfigured ? <App /> : <ConfigError />}</StrictMode>
=======
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
>>>>>>> e14542724eaa5b9d785ae538c31a2e121d3a7fd9
);
