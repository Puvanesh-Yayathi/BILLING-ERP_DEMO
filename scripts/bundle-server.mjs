import { build } from 'esbuild';

/**
 * Bundles the Hono API and all its dependencies (workspace packages included) into one ES module.
 * The Netlify functions import this file, so the platform bundler has nothing left to resolve.
 */
await build({
  entryPoints: ['server/src/index.ts'],
  outfile: 'netlify/server-bundle/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log('Server bundle written to netlify/server-bundle/index.mjs');
