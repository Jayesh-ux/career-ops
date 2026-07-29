import { spawn } from 'child_process';
const child = spawn('node', ['/root/career-ops/transfer-serve.mjs'], {
  detached: true,
  stdio: 'inherit'
});
child.unref();
process.exit(0);
