import { buildSeed } from '../server/src/seed/index.js';
import { verifyState } from '../server/src/seed/verify.js';

/** pnpm verify:seed — builds the seed for today and for a spread of other load dates, and checks every invariant. */
const dates = [new Date().toISOString(), ...Array.from({ length: 6 }, (_, i) => new Date(Date.now() + (i + 1) * 23 * 86400000).toISOString())];
let failed = 0;
for (const now of dates) {
  const seed = buildSeed(now, 1);
  const checks = verifyState(seed.state, seed.audits);
  const bad = checks.filter((c) => !c.ok);
  failed += bad.length;
  console.log(`${now.slice(0, 10)}  ${checks.length - bad.length}/${checks.length} invariants hold`);
  for (const c of checks) if (!c.ok || now === dates[0]) console.log(`  ${c.ok ? 'pass' : 'FAIL'}  ${c.id}. ${c.name}  (${c.detail})`);
}
if (failed) {
  console.error(`${failed} invariant checks failed`);
  process.exit(1);
}
