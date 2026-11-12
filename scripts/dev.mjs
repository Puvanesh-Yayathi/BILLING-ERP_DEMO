import { spawn } from 'node:child_process';

/** pnpm dev: API (tsx, port 8888) and the web app (Vite, port 5180, proxies /api). */
const procs = [
  spawn('pnpm', ['exec', 'tsx', 'watch', 'scripts/dev-server.ts'], { stdio: 'inherit', env: { ...process.env, DATA_STORE: process.env.DATA_STORE ?? 'memory' } }),
  spawn('pnpm', ['--filter', 'web', 'dev'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && code !== 0 && stop()));
