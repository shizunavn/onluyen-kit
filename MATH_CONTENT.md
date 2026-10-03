# Shared math content

`math-content.js` exports CommonJS in Node and `globalThis.OnluyenMath` in the browser. It does not evaluate expressions, contact services, or rewrite algebra.

## Interfaces

- `readContent(string | Element | metadata)` reads text/math segments and reports `ok`, `unsupported`, or `incomplete`.
- `canonicalize(input)` returns a typed canonical representation, key and source content, or a diagnostic. The key is transient; save the source instead.
- `compare(left, right)` returns `equal`, `different`, `unsupported`, or `incomplete`, with a reason. It accepts sources, metadata and canonical representations. Only `equal` establishes structural equivalence; snapshot identity is separate evidence.
- `toPromptContent(input)` returns `ok`, `text`, source `segments` and parsing `diagnostics`. Original LaTeX is preferred. Supported MathML is converted only if its LaTeX round trip preserves structure; otherwise the original MathML is emitted in a marked block. Parse failures are warnings, extraction failures block export. No surrounding HTML, SVG text or error messages are substituted for a formula.
- `inspectPromptSources(questions)` checks completeness and collects provenance/format/phase diagnostics without requiring every formula to parse. `splitPrompt(prompt, limit)` splits at question boundaries with the same header/snapshot and never truncates a question.
- `metadata(input, origin = 'source')` returns serializable source segments. Use `origin: 'inferred'` when rebuilding metadata from legacy answer text rather than actual question sources.
- `text(input)` provides a readable representation. Structural MathML is rendered with explicit LaTeX grouping instead of flattened text.
- `resolveChoice(choices, savedSource, optionId)` requires a unique match, rejects ambiguous/unsupported candidates and checks option-ID conflicts.
- `verifyChoice(choices, savedSource, optionId, images, context)` additionally verifies current snapshot labels and exact original source. The returned `verification.basis` is `structured`, `snapshot` or `blocked`; this does not change `compare()` results. Supplied content must agree with the selected identity. An unrelated unsupported candidate cannot veto a verified option ID.
- `combine(...sources)` combines source segments without flattening formulas.
- `signature(questions)` fingerprints the ordered question identities and contents. It is transient and must be recalculated from source.
- `validateExam(questions, entries, options)` checks every question and answer without selecting or saving anything. It returns `ok`, all `issues`, parser `warnings`, and internal verified `mappings`. Options accept `expectedTotal`, `snapshotId` and the original `snapshotSignature` for positional replies. CLI subsets also pass the original `snapshotQuestions`; every subset question must belong to that unchanged snapshot.
- `matchReport(validation, versions)` exports only the diagnostic allowlist, not answer-entry objects, browser state or credentials.

Unsupported sources have distinct raw fingerprints instead of a shared null canonical key. A changed unknown command/element invalidates its snapshot. Original supplied answer text remains separate from the selected source; `math_content.supplied_answer` retains supplied source metadata when present. Verification describes mapping evidence, never the probability that an answer is mathematically correct.

`OL_PREPARE_EXAM` provides the browser driver's complete collected questions and snapshot to the CLI. The CLI builds subset prompts with that same full-exam identity, validates the entire combined answer set before caching, and imports/starts against the existing driver. Repeated prompt exports retain the token while sources are unchanged. Source collection, parser warnings and answer conflicts remain separate phases in reports. Prompt parts have a 60000-character limit; a single oversized question is explicitly rejected instead of truncated.

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

HTML extraction accounts for retained text/math markup rather than image base64, layout attributes, SVG rendering paths, styles or non-TeX scripts. The 262144-character reader budget still applies to retained content; individual LaTeX formulas remain bounded separately. Original HTML/DOM image collectors keep full image sources. MathML attributes and original TeX are retained, including unsupported syntax. The real pasted HTML fixture for question `#13050131` has only its PNG payload shortened; tests restore a large synthetic payload and check Node, browser, extension DOM/API and CLI exports.

One-sided systems retain their visible delimiter and table structure. MathJax's explicit empty closing fence, `mfenced close=""`, and LaTeX `\left[...\right.` / `\left\{...\right.` agree. Square brackets and braces remain distinct, as do rows, columns and empty cells. The terminal dot in `\right.` is an invisible delimiter, not sentence punctuation. Missing `\right` or an unclosed ordinary bracket still fails structural comparison; prompt export retains its source and snapshot verification remains separate.

Canonical version 2 uses a token stream independent of text/math renderer boundaries. Standalone integers, single-letter variables and capital names of one to three letters (such as triangle `ABC`) compare across prose, LaTeX and MathML. Word whitespace and terminal sentence periods normalize; internal punctuation stays significant. Separate numeric atoms never concatenate. Commas in ambiguous prose are not guessed to be decimal points. Fractions, scripts, accents, roots and tables stay structural atoms; source metadata remains version 1.

Plain formulas may mix Unicode with LaTeX commands: `A={x∈\mathbb{R}|3≤x<7}` retains its visible set braces. A command only applies LaTeX argument rules to its own operands; it does not switch the surrounding expression into LaTeX grouping mode. Command/script argument braces still group their contents, and explicit LaTeX keeps the distinction between grouping `{...}` and visible `\{...\}`. The regression fixture for question `#12759000` is reconstructed from the supplied screenshot and JSON, not captured site HTML.

MathJax may include a final period inside a numeric MathML node, such as `<mn>27.</mn>`. The reader keeps it as a number followed by punctuation, applying the same terminal-period rule as prose and LaTeX. Decimal digits remain intact; periods inside scripts, fraction operands and table cells do not disappear. Malformed numeric nodes such as `27..` remain unsupported.

Degree notation normalizes `60°`, `60^{\circ}`, `60{}^{\circ}` and MathML's attached or empty-base superscript circle to the same suffix. Numeric values, bases and subscripts remain intact, including degrees inside fractions or functions. Bare composition `\circ`, superscript zero, subscript circles and over-annotations remain distinct. Original MathML stays in source metadata; prompt export can render supported degrees directly. Question `#12905060` is covered by the actual pasted HTML, with reordered-choice, snapshot-conflict, import/cache and driver checks. Identity-conflict diagnostics compare the supplied answer against the claimed choice instead of the first unrelated option.

Valid `day/month/year` dates following a prose date introducer (`ngày`, `date`, `dated`, `on`) remain text, including their slashes. This rule applies before inferring compact formulas from un-delimited prose. It does not apply to explicit LaTeX/MathML or bare slash expressions: `1/2/3` still reports ambiguous division. Date components remain significant when comparing contents.

`compare` adds optional `code` and `diagnostic` fields with the first differing token. Whole-exam reports distinguish missing answers, incomplete exams, unavailable rendering, unsupported syntax, multiple matches, conflicting IDs, expired snapshots and changed page content. Source segments in a report are restricted to the relevant question/answer and capped at 8192 characters each.

Positional MCQ/TF answers need the `snapshot_id` emitted by the current prompt and an unchanged original signature. Answer contents and valid IDs still match without that token. Validation is atomic: incomplete or failed imports do not replace the current database, and auto-fill rechecks the live question before each selection and answer button.

The extension shares its complete in-memory exam snapshot between prompt generation, import and start. Successful validation can be reused for the same parsed input or its normalized export. The cache is scoped to the tab/exam revision and invalidated by changed API sources, sidebar question numbers or observed live content. API fingerprints include source segments, including unsupported syntax; answer-selection state is excluded. A changed JSON is validated against the current snapshot before committing. `OL_START_BOT` accepts optional JSON and performs import/start as one request. `OL_VALIDATE_DATABASE` explicitly forces a fresh exam read. Unobserved changes to hidden questions are checked when they render; use the explicit check to re-read the entire exam. Nothing is reused across page reloads.

Short-answer input behavior is unchanged. CLI test-cache schema is now 3, with old caches still readable. Source metadata is versioned independently at 1. Run `npm test` for the shared Node/browser corpus and integration checks.
