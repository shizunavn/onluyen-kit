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
- `signature(questions)` fingerprints the ordered question identities and contents. It is transient and must be recalculated from source.
- `validateExam(questions, entries, options)` checks every question and answer without selecting or saving anything. It returns `ok`, all `issues`, and internal verified `mappings`. Options accept `expectedTotal`, `snapshotId` and the original `snapshotSignature` for positional replies.
- `matchReport(validation, versions)` exports only the diagnostic allowlist, not answer-entry objects, browser state or credentials.

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

Canonical version 2 uses a token stream independent of text/math renderer boundaries. Standalone integers, single-letter variables and capital names of one to three letters (such as triangle `ABC`) compare across prose, LaTeX and MathML. Word whitespace and terminal sentence periods normalize; internal punctuation stays significant. Separate numeric atoms never concatenate. Commas in ambiguous prose are not guessed to be decimal points. Fractions, scripts, accents, roots and tables stay structural atoms; source metadata remains version 1.

Valid `day/month/year` dates following a prose date introducer (`ngày`, `date`, `dated`, `on`) remain text, including their slashes. This rule applies before inferring compact formulas from un-delimited prose. It does not apply to explicit LaTeX/MathML or bare slash expressions: `1/2/3` still reports ambiguous division. Date components remain significant when comparing contents.

`compare` adds optional `code` and `diagnostic` fields with the first differing token. Whole-exam reports distinguish missing answers, incomplete exams, unavailable rendering, unsupported syntax, multiple matches, conflicting IDs, expired snapshots and changed page content. Source segments in a report are restricted to the relevant question/answer and capped at 8192 characters each.

Positional MCQ/TF answers need the `snapshot_id` emitted by the current prompt and an unchanged original signature. Answer contents and valid IDs still match without that token. Validation is atomic: incomplete or failed imports do not replace the current database, and auto-fill rechecks the live question before each selection and answer button.

The extension shares its complete in-memory exam snapshot between prompt generation, import and start. Successful validation can be reused for the same parsed input or its normalized export. The cache is scoped to the tab/exam revision and invalidated by changed API sources, sidebar question numbers or observed live content. API fingerprints include source segments, including unsupported syntax; answer-selection state is excluded. A changed JSON is validated against the current snapshot before committing. `OL_START_BOT` accepts optional JSON and performs import/start as one request. `OL_VALIDATE_DATABASE` explicitly forces a fresh exam read. Unobserved changes to hidden questions are checked when they render; use the explicit check to re-read the entire exam. Nothing is reused across page reloads.

Short-answer input behavior is unchanged. CLI test-cache schema is now 3, with old caches still readable. Source metadata is versioned independently at 1. Run `npm test` for the shared Node/browser corpus and integration checks.
