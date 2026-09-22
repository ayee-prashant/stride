// M1C traceability scoring.
//
// The ten questions are verbatim from the pre-registration, fixed before any
// scoring existed. Both conditions are scored by the same instrument, the same
// questions, in the same order, in one run - per amendment 1. Raw probabilities
// are printed alongside the rounding so the reader can see where the instrument
// was uncertain rather than taking my bucketing on trust.
//
//   node score-traceability.mjs <baseline-records> <stride-records>
import { readFileSync } from 'node:fs';
import { decide } from './jev.mjs';

const QUESTIONS = [
  ['requirement', 'What requirement was this change made against, and at what version?'],
  ['actor', 'Which actor made the change - its name, model and role?'],
  ['observed_state', 'What state of the project had that actor observed at the moment it acted?'],
  ['unresolved', 'Which decisions were unresolved at the time the code was implemented?'],
  ['who_resolved', 'Who resolved those decisions, and can you tell whether that happened before or after the code was written?'],
  ['commit', 'What commit resulted, and on which branch?'],
  ['tests', 'What tests were run, by whom, and what did they find?'],
  ['changed_after', 'What changed in the code as a result of those findings?'],
  ['human_approval', 'What did a human approve, and at what point in the sequence?'],
  ['in_flight', 'If the run had been interrupted, could you tell what work was in flight and who held it?'],
];

async function scoreOne(label, records) {
  const questions = {};
  for (const [key, q] of QUESTIONS) {
    questions[key] = {
      type: 'score',
      instructions: `Using ONLY the records provided, can this question be answered: "${q}"`,
      criteria: [
        'No - the records do not contain this information',
        'Partial - the records hint at it or give part of it, but it must be inferred',
        'Yes - the records state it directly and unambiguously',
      ],
    };
  }
  const r = await decide(records.slice(0, 26000), questions);
  return { label, answers: r.answers, usage: r.usage };
}

const [, , aPath, bPath] = process.argv;
const a = readFileSync(aPath, 'utf8');
const b = readFileSync(bPath, 'utf8');

const A = await scoreOne('baseline', a);
const B = await scoreOne('stride', b);

// score is CONTINUOUS - 1.99, not an index - and probabilities is an object
// keyed by band, not an array. The continuous value is more useful than the
// rounding: it separates "barely partial" from "almost yes", which yes/partial/no
// would discard.
const LABELS = ['no', 'partial', 'yes'];
const band = (s) => LABELS[Math.round(s)] ?? '?';
let ta = 0, tb = 0;

console.log(`
  records: baseline ${a.length}B, stride ${b.length}B
`);
console.log('  question           baseline            stride');
console.log('  ' + '-'.repeat(60));
for (const [key] of QUESTIONS) {
  const sa = A.answers[key].score, sb = B.answers[key].score;
  ta += sa; tb += sb;
  const fmt = (s) => `${band(s).padEnd(8)}${s.toFixed(2)}`;
  const flag = band(sa) !== band(sb) ? '   <-- differs' : '';
  console.log(`  ${key.padEnd(18)} ${fmt(sa).padEnd(19)} ${fmt(sb)}${flag}`);
}
console.log('  ' + '-'.repeat(60));
console.log(`  total (max 20)     ${ta.toFixed(2).padEnd(19)} ${tb.toFixed(2)}`);
console.log(`\n  scoring cost: $${(A.usage.cost + B.usage.cost).toFixed(6)}`);
