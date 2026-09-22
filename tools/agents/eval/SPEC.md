# Task: `parseDuration(text)`

Add `parseDuration` to a new file `parse.js` at the repo root, as a named ESM
export. It is the inverse of `formatDuration`.

## Contract

`parseDuration(text)` takes a duration string and returns the number of
milliseconds as a `number`.

**Accepted form:** one or more `<integer><unit>` parts separated by single
spaces, largest unit first. Units are `d`, `h`, `m`, `s` — days, hours, minutes,
seconds.

```
parseDuration("1d 1h 1m 1s")  === 90061000
parseDuration("1d")           === 86400000
parseDuration("1h 1s")        === 3601000
parseDuration("0s")           === 0
parseDuration("100d")         === 8640000000
```

**Negatives:** a leading `-` negates the whole value.

```
parseDuration("-1d 1h 1m 1s") === -90061000
parseDuration("-1s")          === -1000
```

## Rules

1. Units must appear in descending order (`d` then `h` then `m` then `s`) and
   each unit may appear at most once. `"1s 1d"` and `"1d 1d"` are invalid.
2. A unit may be skipped. `"1h 1s"` is valid.
3. Exactly one space between parts. Leading or trailing whitespace is invalid.
   Two spaces between parts is invalid.
4. The number part is one or more ASCII digits, no sign, no decimal point.
   `"1.5h"`, `"+1h"`, `"1 h"` are invalid.
5. An empty string is invalid.
6. `"0s"` is valid and returns `0`. `"-0s"` is invalid — a negated zero is not a
   meaningful duration, and the formatter never produces it.
7. Any input that is not a string, or does not match the accepted form, throws
   `TypeError`.
8. The function is pure and must not mutate its argument or any global state.

## How this will be judged

An independent test suite written from this document, which you will not see,
run in a clean container. It asserts on exact return values and on `TypeError`
for every invalid form listed above.
