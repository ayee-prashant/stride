// Plain node test harness (no deps) validating formatDuration (agent1) and
// formatBytes (agent2) against the APPROVED contract (doc_41e8bdb1 v2), not
// against whatever the implementations happen to do.
import assert from "node:assert/strict";
import { formatDuration, formatBytes } from "./format.js";

let passed = 0;
let failed = 0;
const violations = [];

function check(label, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    violations.push({ label, message: err.message });
  }
}

// ---------------------------------------------------------------------
// formatDuration(ms) — agent1
// ---------------------------------------------------------------------

const durationCases = [
  [90061000, "1d 1h 1m 1s"], // human's worked example
  [86400000, "1d"],
  [3661000, "1h 1m 1s"],
  [3601000, "1h 1s"], // interior zero minute omitted
  [3600000, "1h"],
  [61000, "1m 1s"],
  [60000, "1m"],
  [1000, "1s"],
  [1999, "1s"], // floor, never round up
  [0, "0s"],
  [1, "0s"],
  [999, "0s"],
  [59999, "59s"], // one ms below the minute boundary
  [3599999, "59m 59s"], // one ms below the hour boundary
  [86399999, "23h 59m 59s"], // one ms below the day boundary
  [8640000000, "100d"], // days uncapped
  [-90061000, "-1d 1h 1m 1s"],
  [-86400000, "-1d"],
  [-1000, "-1s"],
  [1000.9, "1s"], // non-integer, truncated toward zero in magnitude
];

for (const [input, expected] of durationCases) {
  check(`formatDuration(${input}) === ${JSON.stringify(expected)}`, () => {
    assert.equal(formatDuration(input), expected);
  });
}

// Negative sub-second magnitudes: the contract says 0/1/999 -> "0s" and that
// this is "the only case that prints a zero unit" (i.e. the canonical
// zero-duration string). A negative sign prefixed onto a zero-duration
// magnitude ("-0s") is not a coherent duration and is not among the
// documented examples, so we hold implementations to "0s" here.
const negativeSubSecondCases = [-1, -500, -999];
for (const input of negativeSubSecondCases) {
  check(`formatDuration(${input}) === "0s" (no "-0s")`, () => {
    assert.equal(formatDuration(input), "0s");
  });
}

const durationTypeErrorInputs = [NaN, Infinity, -Infinity, "5", null, undefined, {}, [], true];
for (const input of durationTypeErrorInputs) {
  check(`formatDuration(${JSON.stringify(input)}) throws TypeError`, () => {
    assert.throws(() => formatDuration(input), TypeError);
  });
}

check("formatDuration is pure (same input -> same output)", () => {
  assert.equal(formatDuration(90061000), formatDuration(90061000));
});

// ---------------------------------------------------------------------
// formatBytes(n) — agent2
// ---------------------------------------------------------------------

const bytesCases = [
  [0, "0 B"],
  [1, "1 B"],
  [512, "512 B"],
  [1023, "1023 B"], // one below the KB boundary
  [1024, "1 KB"], // not "1.0 KB"
  [1536, "1.5 KB"], // human's worked example
  [1126, "1.1 KB"], // rounding case
  [1048575.9, "1024 KB"], // published OPEN EDGE choice (non-carry)
  [1048576, "1 MB"],
  [1572864, "1.5 MB"],
  [1073741824, "1 GB"],
  [1099511627776, "1 TB"],
  [1125899906842624, "1024 TB"], // above TB, number just grows
  [-1536, "-1.5 KB"],
  [-1024, "-1 KB"],
  [1536.4, "1.5 KB"], // non-integer allowed
];

for (const [input, expected] of bytesCases) {
  check(`formatBytes(${input}) === ${JSON.stringify(expected)}`, () => {
    assert.equal(formatBytes(input), expected);
  });
}

// Negative magnitude that rounds to a displayed zero: same class of issue as
// "-0s" above. A negative sign on a displayed-zero magnitude ("-0 B") is not
// among the documented examples and is not a coherent "negative zero bytes".
check(`formatBytes(-0.4) === "0 B" (no "-0 B")`, () => {
  assert.equal(formatBytes(-0.4), "0 B");
});

const bytesTypeErrorInputs = [NaN, Infinity, -Infinity, "1536", null, undefined, {}, [], true];
for (const input of bytesTypeErrorInputs) {
  check(`formatBytes(${JSON.stringify(input)}) throws TypeError`, () => {
    assert.throws(() => formatBytes(input), TypeError);
  });
}

check("formatBytes is pure (same input -> same output)", () => {
  assert.equal(formatBytes(1536), formatBytes(1536));
});

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------

console.log(`\n${passed + failed} assertions, ${passed} passed, ${failed} failed\n`);
if (violations.length > 0) {
  console.log("Violations:");
  for (const v of violations) {
    console.log(`  - ${v.label}\n      ${v.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("No violations found.");
}
