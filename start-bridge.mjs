import { spawn, spawnSync } from 'child_process';
import { openSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const RT = '/data/data/com.termux/files/home/career-ops';
const OPENCODE_BIN = '/root/career-ops/opencode';
const OPENCODE_CWD = '/root/career-ops';
const OPENCODE_PORT = 4096;
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Load .bridge.env into the bridge env (as the original Termux bridge had).
const env = { ...process.env };
const envPath = join(RT, '.bridge.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }
}

// 2) Kill any stale `opencode serve` (keeps the main opencode agent intact).
try {
  const r = spawnSync('pkill', ['-9', '-f', 'opencode serve'], { timeout: 5000 });
  if (r.status === 0) {
    console.log('bridge-launch: killed stale opencode serve');
    await sleep(1200);
  }
} catch { /* no match — fine */ }

// 3) Ensure a dedicated opencode serve is up for end-user sessions.
async function healthy() {
  try {
    const res = await fetch(OPENCODE_URL + '/health', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

let opencodeSpawned = false;
if (!(await healthy())) {
  const ocLog = openSync(join(RT, 'opencode-serve.log'), 'a');
  const oc = spawn(OPENCODE_BIN, ['serve', '--hostname=127.0.0.1', `--port=${OPENCODE_PORT}`], {
    cwd: OPENCODE_CWD,
    detached: true,
    stdio: ['ignore', ocLog, ocLog],
    env,
  });
  oc.unref();
  opencodeSpawned = true;
  for (let i = 0; i < 30 && !(await healthy()); i++) await sleep(1000);
}
env.OPENCODE_URL = OPENCODE_URL;
env.OPENCODE_PORT = String(OPENCODE_PORT);
console.log(`bridge-launch: opencode serve on ${OPENCODE_URL} spawned=${opencodeSpawned} healthy=${await healthy()}`);

// 4) Start the bridge server detached.
const logPath = join(RT, 'bridge.log');
const out = openSync(logPath, 'a');
const child = spawn('node', ['bridge-server.mjs'], {
  cwd: RT,
  detached: true,
  stdio: ['ignore', out, out],
  env,
});
child.unref();
console.log('bridge-launch: pid=' + child.pid + ' opencodeUrl=' + OPENCODE_URL + ' log=' + logPath);
