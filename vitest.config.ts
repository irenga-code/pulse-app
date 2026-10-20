import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Component tests run in jsdom with the Supabase client and API replaced by in-memory fakes (tests/ui/mocks.ts).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/ui/setup.ts'],
    css: false,
    restoreMocks: false,
  },
});
