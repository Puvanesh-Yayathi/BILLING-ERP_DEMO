import type { Config } from '@netlify/functions';
import { runSweep } from '../../server/src/index.js';

/** Closes idle sessions at their last heartbeat and auto-closes sessions left open from an earlier day. */
export default async (): Promise<Response> => {
  const r = await runSweep();
  console.log(JSON.stringify({ level: 'info', type: 'sweeper', ...r }));
  return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
};

export const config: Config = { schedule: '*/5 * * * *' };
