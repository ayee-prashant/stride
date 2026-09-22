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

1. A unit may be skipped. `"1h 1s"` is valid.
2. The number part is one or more ASCII digits.
3. Any input that is not a string, or does not match the accepted form, throws
   `TypeError`.
4. The function is pure and must not mutate its argument or any global state.

## How this will be judged

An independent test suite written from this document, which you will not see,
run in a clean container.
