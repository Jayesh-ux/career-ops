import { spawn } from 'child_process';
const child = spawn('node', ['/root/career-ops/remote-playwright-server.mjs'], {
  detached: true,
  stdio: 'inherit'
});
child.unref();
process.exit(0);
