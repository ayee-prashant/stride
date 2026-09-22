// Held-out grading for the parseDuration task. Written from SPEC.md before
// either condition ran, and shown to neither. Both conditions are graded by
// this identical file in a clean container.
//
//   node heldout.test.mjs ./path/to/parse.js
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const target = process.argv[2] ?? './parse.js';
let parseDuration;
try {
  ({ parseDuration } = await import(pathToFileURL(path.resolve(target)).href));
} catch (e) {
  console.log(`LOAD FAILED: ${e.message}`);
  console.log('0 assertions, 0 passed, 0 failed');
  process.exit(1);
}
if (typeof parseDuration !== 'function') {
  console.log('NO EXPORT: parseDuration is not exported as a function');
  console.log('0 assertions, 0 passed, 0 failed');
  process.exit(1);
}

let passed = 0, failed = 0;
const fails = [];
const check = (label, fn) => {
  try { fn(); passed++; }
  catch (e) { failed++; fails.push(`${label}  ->  ${e.message}`); }
};
const eq = (a, b) => { if (a !== b) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const rejects = (input) => {
  let threw = null;
  try { parseDuration(input); } catch (e) { threw = e; }
  if (!threw) throw new Error('did not throw');
  if (!(threw instanceof TypeError)) throw new Error(`threw ${threw.constructor.name}, not TypeError`);
};

// --- the worked examples in the spec -------------------------------------
for (const [input, expect] of [
  ['1d 1h 1m 1s', 90061000],
  ['1d', 86400000],
  ['1h 1s', 3601000],
  ['0s', 0],
  ['100d', 8640000000],
  ['-1d 1h 1m 1s', -90061000],
  ['-1s', -1000],
]) check(`parseDuration(${JSON.stringify(input)}) === ${expect}`, () => eq(parseDuration(input), expect));

// --- every single unit, and every skip pattern (rule 2) ------------------
for (const [input, expect] of [
  ['1s', 1000], ['1m', 60000], ['1h', 3600000],
  ['59s', 59000], ['59m', 3540000], ['23h', 82800000],
  ['1m 1s', 61000], ['1h 1m', 3660000], ['1d 1s', 86401000],
  ['1d 1m', 86460000], ['1d 1h', 90000000], ['1h 1m 1s', 3661000],
  ['1d 1m 1s', 86461000], ['1d 1h 1s', 90001000], ['1d 1h 1m', 90060000],
  ['0d', 0], ['0h', 0], ['0m', 0],
  ['999d', 86313600000], ['1000s', 1000000],
]) check(`parseDuration(${JSON.stringify(input)}) === ${expect}`, () => eq(parseDuration(input), expect));

// --- negation applies to the whole value, not the first part -------------
for (const [input, expect] of [
  ['-1h 1m', -3660000], ['-1d', -86400000], ['-100d', -8640000000], ['-59s', -59000],
]) check(`parseDuration(${JSON.stringify(input)}) === ${expect}`, () => eq(parseDuration(input), expect));

// --- rule 1: order and repetition ---------------------------------------
for (const bad of ['1s 1d', '1m 1h', '1h 1d', '1s 1m', '1d 1d', '1s 1s', '1h 1h 1s', '1m 1m'])
  check(`rejects out-of-order/repeated ${JSON.stringify(bad)}`, () => rejects(bad));

// --- rule 3: whitespace is exact ----------------------------------------
for (const bad of [' 1d', '1d ', '1d  1h', '1d\t1h', '\n1d', '1d\n', '1d 1h ', ' '])
  check(`rejects whitespace form ${JSON.stringify(bad)}`, () => rejects(bad));

// --- rule 4: the number part --------------------------------------------
for (const bad of ['1.5h', '+1h', '1 h', 'h', '1', 'd1', '1x', 'one d', '١d', '1e3s', '0x1s'])
  check(`rejects number/unit form ${JSON.stringify(bad)}`, () => rejects(bad));

// --- rules 5 and 6: empty, and negated zero ------------------------------
for (const bad of ['', '-0s', '-0d', '-0s 0m'])
  check(`rejects ${JSON.stringify(bad)}`, () => rejects(bad));

// --- rule 7: non-strings ------------------------------------------------
for (const bad of [null, undefined, 0, 1000, NaN, {}, [], true, Symbol('x'), 90061000])
  check(`rejects non-string ${String(typeof bad)} ${String(bad?.toString?.() ?? bad)}`, () => rejects(bad));

// --- rule 8: purity, and round-tripping the formatter --------------------
check('pure: same input gives same output', () => eq(parseDuration('1d 1h'), parseDuration('1d 1h')));
check('a frozen string argument is accepted', () => eq(parseDuration(Object.freeze(String('1h'))), 3600000));
for (const [input, ms] of [['1d 1h 1m 1s', 90061000], ['59m 59s', 3599000], ['23h 59m 59s', 86399000]])
  check(`round-trips the formatter output ${JSON.stringify(input)}`, () => eq(parseDuration(input), ms));

console.log(`\n${passed + failed} assertions, ${passed} passed, ${failed} failed`);
if (fails.length) {
  console.log('\nfailures:');
  for (const f of fails.slice(0, 12)) console.log('  ' + f);
  if (fails.length > 12) console.log(`  ... and ${fails.length - 12} more`);
}
process.exit(failed === 0 ? 0 : 1);
