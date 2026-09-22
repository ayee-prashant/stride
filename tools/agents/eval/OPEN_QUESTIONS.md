# Open questions

Raised by an independent review of parse.js against SPEC.md. Each was
unspecified in the spec, so the implementation had to choose a reading. A human
has resolved them. Apply the resolutions.

---

## OQ-1 — negated zero

- **Requirement affected:** negative durations are allowed (`-1s` is valid).
- **Unspecified case:** how a negative zero duration such as `"-0s"` behaves.
- **Observed implementation:** returns `0`.
- **Consequence:** a caller cannot distinguish "zero" from "a malformed negative
  zero", and the formatter never produces `-0s`, so accepting it admits input
  the rest of the system cannot generate.
- **Interpretations:**
  - A. Accept and return `0`.
  - B. Preserve JavaScript `-0`.
  - C. Reject a `-` applied to a zero-valued duration.
- **RESOLUTION: C** — reject with `TypeError`. This applies to any zero-valued
  duration carrying a sign, such as `"-0s"`, `"-0d"`, `"-0d 0s"`.

---

## OQ-2 — repeated and out-of-order units

- **Requirement affected:** parts are `<integer><unit>`, largest unit first.
- **Unspecified case:** whether a unit may repeat (`"1h 1h"`) or appear out of
  order (`"1s 1d"`).
- **Observed implementation:** rejects both.
- **Interpretations:**
  - A. Reject both.
  - B. Allow repetition and sum the parts.
- **RESOLUTION: A** — reject both. Units must be strictly descending and may
  appear at most once.

---

## OQ-3 — whitespace

- **Requirement affected:** parts are separated by a space.
- **Unspecified case:** leading or trailing whitespace, and more than one space
  between parts.
- **Observed implementation:** rejects them.
- **RESOLUTION** — reject. Exactly one space between parts, no leading or
  trailing whitespace of any kind.
