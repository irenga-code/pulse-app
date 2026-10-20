#!/usr/bin/env node
// Pulse environment doctor. `npm run doctor` (full) / runs automatically before `npm run dev` (--quick).
// Catches the problems that make `npm run dev` fail on WSL/Ubuntu BEFORE Vite's cryptic errors.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { listeners } from './lib/port.mjs';

const quick = process.argv.includes('--quick');
const root = process.cwd();
const PORT = Number(process.env.PORT || process.env.VITE_PORT || 5173);
const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const problems = [];
const warnings = [];
const oks = [];

// ---- Node version
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 18)) {
  problems.push(`Node ${process.versions.node} is too old (Vite 5 needs >= 18.18, 20 LTS recommended).\n    Fix: nvm install 20 && nvm use 20   (the repo has an .nvmrc)`);
} else oks.push(`Node ${process.versions.node}`);

// ---- dependencies installed, and installed on THIS platform
const nm = path.join(root, 'node_modules');
if (!fs.existsSync(nm)) {
  problems.push('node_modules is missing.\n    Fix: npm ci');
} else {
  const bin = path.join(nm, '.bin');
  const broken = fs.existsSync(bin)
    ? fs.readdirSync(bin).filter((f) => {
        try { return fs.statSync(path.join(bin, f)).size === 0; } catch { return true; }
      })
    : ['(.bin folder missing)'];
  if (broken.length) {
    problems.push(
      `node_modules/.bin is broken (${broken.length} empty entries, e.g. ${broken.slice(0, 3).join(', ')}).\n` +
      '    This happens when node_modules is zipped / copied between Windows, WSL and other machines: the\n' +
      '    symlinks are flattened into empty files, so "vite: Permission denied" follows.\n' +
      '    Fix:  npm run reinstall      (= rm -rf node_modules && npm ci)\n' +
      '    Tip:  never copy node_modules; keep the project inside WSL (e.g. ~/pulse), and zip it without node_modules.'
    );
  } else oks.push('node_modules/.bin looks healthy');

  const esbuildDir = path.join(nm, '@esbuild');
  const want = `${process.platform}-${process.arch}`;
  if (fs.existsSync(esbuildDir) && !fs.readdirSync(esbuildDir).includes(want)) {
    problems.push(`esbuild was installed for another OS/CPU (found: ${fs.readdirSync(esbuildDir).join(', ') || 'none'}; need: ${want}).\n    Fix: npm run reinstall`);
  }
}

// ---- .env
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  warnings.push('.env not found: the app will show a setup screen instead of loading.\n    Fix: cp .env.example .env   then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Supabase -> Settings -> API)');
} else {
  const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])
  );
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) warnings.push('.env is missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY.');
  else if (!/^https?:\/\//.test(url)) warnings.push('VITE_SUPABASE_URL should look like https://<project>.supabase.co');
  else oks.push('.env has Supabase settings');
}

// ---- WSL: project on a Windows drive
if (process.cwd().startsWith('/mnt/')) {
  warnings.push('Project is on a Windows drive (/mnt/...). File watching is slow and installs are fragile there.\n    Vite is configured to poll so HMR works, but moving the project into WSL (cp -r to ~/pulse) is much faster.');
}

// ---- port
const isFree = (port, host) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => resolve(e.code === 'EADDRINUSE' ? false : true));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, host);
});
const free = (await isFree(PORT, '0.0.0.0')) && (await isFree(PORT, '127.0.0.1'));
if (!free) {
  const who = listeners(PORT).map((l) => `PID ${l.pid}: ${l.cmd.slice(0, 90)}`).join('\n    ');
  warnings.push(`Port ${PORT} is already in use${who ? `:\n    ${who}` : ''}.\n    Vite will automatically use the next free port (watch the "Local:" URL it prints).\n    To get ${PORT} back: npm run dev:free   (stops the old dev server)\n    Note: Supabase email links return to the app's origin, so add every port you use to Authentication -> URL Configuration.`);
} else oks.push(`Port ${PORT} is free`);

// ---- report
if (!quick) oks.forEach((m) => console.log(`${c(32, '✓')} ${m}`));
warnings.forEach((m) => console.log(`${c(33, '!')} ${m}`));
problems.forEach((m) => console.log(`${c(31, '✗')} ${m}`));
if (problems.length) {
  console.log(c(31, `\n${problems.length} blocking problem(s). Fix the above, then run npm run dev again.`));
  process.exit(1);
}
if (!quick) console.log(c(32, '\nAll good. Run: npm run dev') + (os.platform() === 'linux' && /microsoft/i.test(os.release()) ? '   (WSL detected: open http://localhost:' + PORT + ' in your Windows browser)' : ''));
