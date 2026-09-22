# Task for the agent

Write `roman.js` in this directory. It must export one function using CommonJS:

```js
module.exports = { toRoman };
```

`toRoman(n)` converts an integer to a Roman numeral string.

## Rules

- Accept integers from 1 to 3999 inclusive.
- Use standard subtractive notation: 4 is `IV`, 9 is `IX`, 40 is `XL`, 90 is `XC`, 400 is `CD`, 900 is `CM`.
- For any input that is not an integer in 1..3999 — including `0`, negatives, `4000`, `3.5`, `NaN`, strings and `null` — throw a `RangeError`.

## Examples

| Input | Output |
|---|---|
| 1 | `I` |
| 4 | `IV` |
| 9 | `IX` |
| 14 | `XIV` |
| 40 | `XL` |
| 90 | `XC` |
| 400 | `CD` |
| 944 | `CMXLIV` |
| 1994 | `MCMXCIV` |
| 2026 | `MMXXVI` |
| 3999 | `MMMCMXCIX` |

## Constraints

- Plain JavaScript, no dependencies, no network.
- Write only `roman.js`. Do not modify `TASK.md` or `verify.js`.
- `node verify.js` must pass.
