import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ConfigError from './components/ConfigError.tsx';
import { isSupabaseConfigured } from './lib/supabase';
import { hashFromPath } from './hooks/useHashRoute';
import './index.css';

hashFromPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSupabaseConfigured ? <App /> : <ConfigError />}</StrictMode>
);
