import { spawn } from 'node:child_process';

/** Production build preview: API on 8888 and the built web app on 5181 (used by Lighthouse CI). */
const procs = [
  spawn('pnpm', ['exec', 'tsx', 'scripts/dev-server.ts'], { stdio: 'inherit', env: { ...process.env, DATA_STORE: 'memory' } }),
  spawn('pnpm', ['--filter', 'web', 'exec', 'vite', 'preview'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
