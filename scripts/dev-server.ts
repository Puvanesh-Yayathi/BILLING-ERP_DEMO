import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { app, runSweep } from '../server/src/index.js';

/**
 * Local API server for `pnpm dev`: the same Hono app the Netlify Function runs,
 * on the in-memory store (data resets when the process restarts). Use `pnpm dev:netlify`
 * for the real Netlify runtime with the local Blobs sandbox.
 */
const port = Number(process.env.API_PORT ?? 8888);
const root = new Hono();
root.route('/', app);
serve({ fetch: root.fetch, port }, () => console.log(`API ready on http://localhost:${port}/api/v1 (store: ${process.env.DATA_STORE ?? 'memory'})`));
setInterval(() => void runSweep().catch((e: unknown) => console.error('sweeper', e)), 5 * 60 * 1000);
