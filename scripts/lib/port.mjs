// Find which process is LISTENing on a TCP port using only /proc (works on any Linux/WSL, no ss/lsof needed).
import fs from 'node:fs';

function listeningInodes(port) {
  const inodes = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10) continue;
      const [, localPort] = f[1].split(':');
      if (f[3] === '0A' && parseInt(localPort, 16) === port) inodes.add(f[9]); // 0A = LISTEN
    }
  }
  return inodes;
}

/** @returns {{pid:number, cmd:string}[]} */
export function listeners(port) {
  const inodes = listeningInodes(port);
  if (!inodes.size) return [];
  const found = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return []; }
  for (const pid of pids) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; } // not ours / exited
    const hit = fds.some((fd) => {
      try { return inodes.has((fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/) || [])[1]); } catch { return false; }
    });
    if (hit) {
      let cmd = '';
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch { /* gone */ }
      found.push({ pid: Number(pid), cmd });
    }
  }
  return found;
}
