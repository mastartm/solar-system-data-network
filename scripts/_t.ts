import { run, marsScn } from './asama9-lib';
const sc = marsScn();
for (const pol of ['fifo', 'priority', 'coverage', 'rolling', 'adaptive'] as const) {
  const out: string[] = [];
  for (const [nm, o] of [['hl5', {}], ['hl0', { cfg: { valueHalfLivesSec: [] } }]] as const) {
    run(sc, 3, pol, o as never); // ısınma
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) run(sc, 3, pol, o as never);
    out.push(`${nm} ${Math.round((performance.now() - t0) / 3)}ms`);
  }
  console.log(pol, out.join(' '));
}
