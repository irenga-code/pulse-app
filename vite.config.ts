import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // WSL2: files under /mnt/c, /mnt/d ... live on Windows (9p/NTFS) where inotify does not fire,
  // so HMR would silently never update. Fall back to polling there.
  const onWindowsDrive = process.cwd().startsWith('/mnt/');
  const port = Number(env.PORT || env.VITE_PORT || 5173);

  // Camera access (getUserMedia) needs a secure context. localhost counts as secure, but a phone
  // opening http://<LAN-IP>:5173 does not. `npm run dev:https` serves a self-signed certificate.
  const plugins: PluginOption[] = [react()];
  if (env.VITE_HTTPS === '1') {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }

  return {
    plugins,
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // Bind IPv4 on all interfaces. With the default ("localhost") Vite can listen on ::1 only, and
      // WSL2's localhost forwarding to Windows browsers/phones then refuses the connection.
      host: env.VITE_HOST || true,
      port,
      // If the port is busy (e.g. a forgotten dev server) Vite moves to the next free one instead of
      // failing. `npm run dev:free` stops the old server if you want 5173 back.
      strictPort: false,
      watch: onWindowsDrive ? { usePolling: true, interval: 300 } : undefined,
    },
    // the emoji data (~500 kB, lazy-loaded the first time a picker opens) is intentionally one chunk
    build: { chunkSizeWarningLimit: 600 },
    preview: { host: true, port: 4173 },
    // NOTE: lucide-react must NOT be excluded from pre-bundling. It re-exports ~3,500 icon modules;
    // excluded, the dev server makes thousands of requests on every page load (slow / EMFILE on WSL).
  };
});
