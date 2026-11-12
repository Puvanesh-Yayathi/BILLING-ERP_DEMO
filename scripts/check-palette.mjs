import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Design checklist item 3: no colour outside the doc 08 token list (plus black for printed documents). */
const ALLOWED = ['#ffffff', '#f3f5f8', '#dce2ea', '#0f2a47', '#1f5f99', '#8a5a2b', '#5b6878', '#1e7b4f', '#a66a12', '#b3261e', '#000000', '#fff'];
const RGBA_OK = [/rgba\(0,\s*0,\s*0,\s*0?\.\d+\)/, /rgba\(91,\s*104,\s*120,\s*0\.4\)/];
const roots = ['apps/web/src', 'apps/web/index.html', 'apps/web/tailwind.config.ts', 'apps/web/public'];
const bad = [];
function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) return readdirSync(p).forEach((f) => walk(join(p, f)));
  if (!/\.(tsx?|css|html|svg)$/.test(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) if (!ALLOWED.includes(m[0].toLowerCase())) bad.push(`${p}: ${m[0]}`);
  for (const m of text.matchAll(/rgba?\([^)]*\)/g)) if (!RGBA_OK.some((r) => r.test(m[0]))) bad.push(`${p}: ${m[0]}`);
  for (const m of text.matchAll(/(linear|radial|conic)-gradient/g)) bad.push(`${p}: ${m[0]}`);
}
roots.forEach(walk);
// Built CSS too, when present.
try {
  for (const f of readdirSync('apps/web/dist/assets').filter((f) => f.endsWith('.css'))) {
    const text = readFileSync(join('apps/web/dist/assets', f), 'utf8');
    for (const m of text.matchAll(/(linear|radial|conic)-gradient/g)) bad.push(`dist/${f}: ${m[0]}`);
  }
} catch {
  /* not built yet */
}
if (bad.length) {
  console.error(`Colours outside the palette or gradients found:\n${[...new Set(bad)].join('\n')}`);
  process.exit(1);
}
console.log('Palette check passed: only doc 08 tokens are used.');
