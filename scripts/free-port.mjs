#!/usr/bin/env node
// `npm run dev:free` — stop the dev server that is holding the port (default 5173) so Vite can use it.
import { listeners } from './lib/port.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const found = listeners(PORT);
if (!found.length) {
  console.log(`Port ${PORT} is free.`);
  process.exit(0);
}
for (const { pid, cmd } of found) {
  if (pid !== process.pid && /vite|node/.test(cmd)) {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped PID ${pid}: ${cmd.slice(0, 100)}`);
  } else {
    console.log(`Port ${PORT} is used by PID ${pid} (${cmd.slice(0, 100) || 'unknown'}), which does not look like a dev server. Not touching it.`);
  }
}
