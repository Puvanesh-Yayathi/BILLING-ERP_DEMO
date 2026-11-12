import type { Config } from '@netlify/functions';
import { app } from '../server-bundle/index.mjs';

/** One Hono app serves /api/v1/*. The platform rate limit runs at Netlify's edge before the function. */
export default async (req: Request): Promise<Response> => app.fetch(req);

export const config: Config = {
  path: '/api/v1/*',
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
