# Shared math content

`math-content.js` exports CommonJS in Node and `globalThis.OnluyenMath` in the browser. It does not evaluate expressions, contact services, or rewrite algebra.

## Interfaces

- `readContent(string | Element | metadata)` reads text/math segments and reports `ok`, `unsupported`, or `incomplete`.
- `canonicalize(input)` returns a typed canonical representation, key and source content, or a diagnostic. The key is transient; save the source instead.
- `compare(left, right)` returns `equal`, `different`, `unsupported`, or `incomplete`, with a reason. It accepts sources, metadata and canonical representations. Only `equal` authorizes matching.
- `metadata(input, origin = 'source')` returns serializable source segments. Use `origin: 'inferred'` when rebuilding metadata from legacy answer text rather than actual question sources.
- `text(input)` provides a readable representation. Structural MathML is rendered with explicit LaTeX grouping instead of flattened text.
- `resolveChoice(choices, savedSource, optionId)` requires a unique match, rejects ambiguous/unsupported candidates and checks option-ID conflicts.
- `combine(...sources)` combines source segments without flattening formulas.

## Saved data

Existing Vietnamese fields remain supported. Optional `math_content` on a database answer has this shape:

```json
{
  "version": 1,
  "question": { "version": 1, "origin": "source", "segments": [{ "format": "text", "raw": "Chọn công thức." }] },
  "answer": { "version": 1, "origin": "source", "segments": [{ "format": "latex", "raw": "x+y\\le 50" }] },
  "statements": { "a": { "version": 1, "origin": "source", "segments": [{ "format": "latex", "raw": "x^2" }] } }
}
```

`answer` applies to MCQ and `statements` to true/false answers. Question objects expose `math_content.question`; each choice exposes its own source metadata. Supported segment formats are `text`, `latex`, `mathml` and `plain`. Do not edit a display field while retaining stale source metadata: edit/remove the corresponding metadata too.

## Boundaries

The reader supports common operators, relations, fractions, roots, scripts, sets, intervals, functions, accents/vectors, sums/integrals, matrices and systems. Unsupported commands/elements remain diagnosable; missing MathJax source is incomplete. It is deliberately conservative about flattened legacy data, malformed syntax and ambiguous positional caches. Layout and rendering differences can normalize; case, operators, order, grouping and numeric structure remain significant.

Short-answer input behavior is unchanged. CLI test-cache schema is now 3, with old caches still readable. Source metadata is versioned independently at 1. Run `npm test` for the shared Node/browser corpus and integration checks.
