// Objective grader for the roman.js task. Same script for every agent.
const path = require("node:path");

let mod;
try {
  mod = require(path.join(__dirname, "roman.js"));
} catch (e) {
  console.log("FAIL: roman.js could not be loaded -> " + e.message);
  process.exit(1);
}

const toRoman = mod && mod.toRoman;
if (typeof toRoman !== "function") {
  console.log("FAIL: module.exports.toRoman is not a function");
  process.exit(1);
}

const cases = [
  [1, "I"], [2, "II"], [3, "III"], [4, "IV"], [5, "V"], [9, "IX"], [10, "X"],
  [14, "XIV"], [40, "XL"], [50, "L"], [90, "XC"], [100, "C"], [400, "CD"],
  [500, "D"], [900, "CM"], [944, "CMXLIV"], [1000, "M"], [1994, "MCMXCIV"],
  [2026, "MMXXVI"], [3549, "MMMDXLIX"], [3999, "MMMCMXCIX"],
];
const bad = [0, -1, 4000, 3.5, NaN, Infinity, "5", null, undefined, {}];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  let got;
  try { got = toRoman(input); } catch (e) { got = "threw " + e.constructor.name; }
  if (got === expected) pass++;
  else { fail++; console.log(`  FAIL toRoman(${input}) -> ${JSON.stringify(got)}, expected ${expected}`); }
}
for (const input of bad) {
  let threw = false;
  try { toRoman(input); } catch (e) { threw = e instanceof RangeError; }
  if (threw) pass++;
  else { fail++; console.log(`  FAIL toRoman(${JSON.stringify(input)}) should throw RangeError`); }
}

console.log(`\n${pass} passed, ${fail} failed, ${cases.length + bad.length} total`);
console.log(fail === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(fail === 0 ? 0 : 1);
