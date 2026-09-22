// Ask one typed question about a file and print the probability.
//   node classify.mjs <file> <instructions> <true-criteria> <false-criteria>
// Exits 0 if p > 0.5, 1 otherwise, so shell callers can branch on it - but the
// probability is printed so a borderline case is visible rather than rounded.
import { readFileSync } from 'node:fs';
import { noul } from './jev.mjs';

const [, , file, instructions, tCrit, fCrit] = process.argv;
if (!file || !instructions) { console.error('usage: classify.mjs <file> <instructions> <true> <false>'); process.exit(2); }
const state = readFileSync(file, 'utf8').slice(0, 24000);
const r = await noul(state, instructions, { true: tCrit ?? 'yes', false: fCrit ?? 'no' });
console.log(r.p.toFixed(3));
// exitCode, not process.exit(): forcing exit while the fetch handle is still
// closing trips a libuv assertion on Windows, which prints a crash after the
// answer and would look like the classifier failing when it did not.
process.exitCode = r.p > 0.5 ? 0 : 1;
