# FIX-2458 · Decisions

[Spec](SPEC.md) · **Decisions**

What was considered, what was chosen, and what each choice locks in. Three decisions are the
sign-off. D1 narrows the issue's proposal; D2 and D3 pick between shapes it left open.

## The tree

```mermaid
flowchart TD
  I["FIX-2458"] --> D1["D1 · core's existing readers per job · one failure kind stays"]
  D1 -.->|"rejected · a second answer to three questions"| X1["four new failure kinds"]
  I --> D2["D2 · the peer range is the tested range · one gate in core refuses outside it"]
  D2 -.->|"rejected · a claude-code release per SDK patch"| X2["exact pin for all three"]
  D2 -.->|"rejected · an untested wire runs silently"| X3["any version for all three"]
  I --> D3["D3 · each name carries its package · shared shapes once in core"]
  D3 -.->|"rejected · collides when two harnesses are installed"| X4["the same names in every harness"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A stop, an unusable SDK and a bad config use the readers core already has; `HarnessFailureKind` stays one kind

| | |
|---|---|
| **Instead of** | The issue's proposal: add `aborted`, `sdk-not-installed`, `sdk-version-mismatch` and `config` to `HarnessFailureKind`, set by every harness |
| **Because** | Each of the three questions already has its reader. A stop is `isAbortLike`, which the generator and the discovery tools act on. Codex's and Cursor's stop errors fail it today ([evidence](poc/facts/check.mjs)), and so does Claude Code's when the signal has a reason: harness-manager stops runs with a timeout, a plain `Error` for a steer, and a superseded-attempt error. "Can it run here" is the readiness check, the `harness-readiness` mechanism harness-manager serves; it misses only the version. A config error is thrown when the block is built, before any host can branch on it. A kind for each would be a second answer that can disagree with the first |
| **Locks in** | Every harness's stop error has an AbortError at the root of its `cause` chain, holding the signal's reason, so it is abort-like whatever the reason. Codex's and Cursor's keep their resumable session id; Claude Code's gains a stop error of its own. A harness used as a generator's tool now stops the generator when its run is stopped, where today the model is handed a failed call. Every readiness check reports an absent SDK and one outside the tested range, with a remedy. A host with only the thrown error gets `null` for an unusable SDK and reads the message. Adding a kind later stays a one-member widening |

![D1: four new failure kinds, beside the readers core has. Decides it: one answer per question. Price: a host with only the thrown error can't classify an unusable SDK. Flips if a host must classify one from the error alone](figures/d1-readers.svg)

It comes down to one answer per question: a kind would answer "was it stopped" a second way.

**What would change my mind:** a host that meets an unusable SDK only as a thrown error, with
no readiness check in its path. Then `sdk-not-installed` earns its kind.

<a name="d2"></a>
## D2 · One SDK policy: the peer range is the tested range, and outside it one gate in core refuses

| | |
|---|---|
| **Instead of** | Exact pins for all three, which claude-code would join · or any version for all three, which Codex and Cursor would leave |
| **Because** | Each package translates its vendor's wire, so an untested version produces malformed items, not an error; that is why Codex and Cursor gate. But claude-code's comments were measured on SDK 0.3.234 while the lockfile pins 0.3.316: an exact pin would need a claude-code release for each patch. A range covers both: one version wide for Codex and Cursor, a tested span for Claude |
| **Locks in** | Each package's `peerDependencies` range is what it tested, and the readiness check and the block refuse outside it, naming both. The refusal is one gate, `assertTestedSdkVersion` on `core/internal`, given each package's range and installed-version reader, throwing one `HarnessSdkVersionMismatchError`; Codex's and Cursor's gates and classes go, and claude-code gains none. claude-code moves from `*` to a range: an adopter on an untested SDK gets a refusal with a remedy at build time. Widening a range is a release |

![D2: the peer range is the tested range, beside exact pins for all and any version for all. Decides it: keeping both a gate and claude-code's release cadence. Price: each new span is a release. Flips if a vendor breaks its wire inside a patch](figures/d2-version-policy.svg)

It comes down to a gate and a cadence: an exact pin loses claude-code's cadence, any version
loses the gate.

**What would change my mind:** the Claude Agent SDK changing its message shape inside a patch.
Then claude-code's range is one version wide, under the same policy.

<a name="d3"></a>
## D3 · Every harness name carries its package's name; shared shapes live once in core

| | |
|---|---|
| **Instead of** | The issue's same-named `listModels()` in all three packages |
| **Because** | Three declarations named `listModels` collide when one app installs two harnesses, which leg b refuses and Kitchen Sink would alias at every import. Today 8 names already collide this way. A shape that is the same everywhere belongs once in core, and a function that runs one vendor says which |
| **Locks in** | Public names: `HarnessModelInfo`, `HarnessModelList` and `HARNESS_BASE_PASS` on `core/harness`; `listCursorModels`. claude-code spells every name `ClaudeCode`/`claudeCode`/`CLAUDE_CODE_`, as Codex and Cursor already use their package names, and its one entry is the package root. Old names reach adopters per ER-3 and Q1's answer |

![D3: names that carry their package, beside the same names in every harness. Decides it: two harnesses installed in one app. Price: one rename round for claude-code. Flips if no app installs two harnesses](figures/d3-naming.svg)

It comes down to an app with two harnesses: shared names collide, and Kitchen Sink has three.

## Decided, not asked

- **From the epic, cited, not restated:** [ER-1](../../epics/FIX-2447/DECISIONS.md#who-owns-what), [ER-3](../../epics/FIX-2447/DECISIONS.md#who-owns-what), [ER-7](../../epics/FIX-2447/DECISIONS.md#who-owns-what) · **cells owned** in [FIX-2564's grid](../FIX-2564/SPEC.md#what-changes): `surface.root.claude-code`, `surface.root.codex`, `surface.root.cursor`; contributes to `surface.collisions`.
- **The shared model type is the shape both lists already have:** `id`, `label`,
  `description?`, `isDefault`, and `{ status: "models" | "failed" }`. Cursor's variants (Grok's
  effort) ride a Cursor-only extension, not the shared type.
- **`listCursorModels` asks the Cursor SDK's `Cursor.models.list()`**, under the same never-throws
  contract as the other two. Kitchen Sink maps Grok's effort from the variants it returns.
- **`HARNESS_BASE_PASS` is the 13 names the three lists share** (`PATH`, `HOME`, `USER`, `SHELL`,
  `TMPDIR` and the proxy variables). Each harness's list is the base plus its own credentials and
  certificates. A value for `harnessEnv`, not a second builder.
- **Translate and emit leave the public entries of all three.** Nothing outside the packages
  imports them. The version helpers leave too, once Kitchen Sink reads readiness instead.
- **Error classes stay, one set per package, renamed under D3** (`ClaudeAgentRunError` becomes
  `ClaudeCode…`), except the version mismatch: one `HarnessSdkVersionMismatchError` for all three.
  Docs branch on core's readers.
- **The shared version class lives on `core/internal`, not `core/harness`.** No adopter catches
  either class today (no import outside the packages; only `cursor.md`'s failure table names one),
  and D1 already gives "can it run here" its public answer, the readiness check. A public class
  would be a second answer to teach. Its `code` (`HARNESS_SDK_VERSION_MISMATCH`) stays readable
  to a host that must branch. It moves to `core/harness` the day an adopter catches it. The two
  old codes are not retired values: the class is thrown when the block is built, never emitted
  into an item or stored.
- **The convergence point for "a stop is abort-like"** is each stop error's constructor: it
  defaults its root cause to an AbortError, so no construction site can miss it. Codex builds its
  in four places and Cursor in five (`abortRace`, the pre-run signal check, the session-id
  re-mint in `toRunFailure`, which must keep the cause, and Cursor's mid-run check); Kitchen
  Sink's scripted Codex builds a fifth (`lib/codex-mode.ts`). Claude Code's `rejectOnAbort` is
  its one site.
- **No retired runtime value.** The error `code` strings (`CLAUDE_AGENT_RUN_FAILED`, …) and the
  value of `SDK_SESSION_ID_KEY` are emitted into items and stored, so they keep their values when
  their exported names change. FIX-2454's refusal helper is not used; every change is a moved or
  removed export, under Q1.
- **A range's lower bound is the version the lockfile pins** (claude-code: 0.3.316, held by the
  root `pnpm.overrides`). Versions named only in comments are not tested.
- **The goal check extends Kitchen Sink's parity suite**, the one place the three harnesses
  already share a table. These are Kitchen Sink's harness files, edited only by this issue.

## Considered and dropped

| Alternative | Why not |
|---|---|
| One set of error classes in core for all three | Sound, and LAB-156's. The classes carry vendor detail, and nothing branches on them once the readers do. The version class is the exception taken here: its fields (SDK, installed, tested) carry no vendor detail |
| A shared emitter | The issue already defers it; LAB-156 |
| A new harness-lines guide page | Already written: *Steering a running turn* in `coding-agents.md` |
| Keep `./sdk` beside a new root | Two doors to one module; with `./cli` gone, the root is the only door |

## Settled

- **Codex's and Cursor's stop errors are not abort-like; Claude Code's is only when the stop has
  no reason** — **CONFIRMED** by [`poc/facts/check.mjs`](poc/facts/check.mjs), which runs core's
  `isAbortLike` on each, and on a timeout and a plain-`Error` reason.
- **The factual base** (88 claude-code names in five spellings, 8 cross-package names, 5/5/2
  error classes, 13 shared environment names, no `./cli` consumer) — re-derived by the same
  checker; `--control` plants an unclassified name and it fails. It corrected one count in the
  draft: the shared base is 13 names, not 15.

## Analysis

Skipped in member mode: the epic-agent runs `analysis` and `reuse-review` over the spec set.

## How it got here

- **Draft** — framed as one reader per job across three harnesses; narrowed the issue's four
  failure kinds to core's existing readers (Step 3.5: *refine the substrate*), a tested-range
  version policy, and package-named exports with shared shapes in `core/harness`.
- **Validation** — a stop must be abort-like whatever the signal's reason, since harness-manager
  stops with timeouts and plain errors; the collision cell left for FIX-2449's check; the range
  match, the `./sdk` consumers and four more docs pages named.
- **Set review (Nov 5)** — the version gate moves, not just the reader: one `assertTestedSdkVersion`
  and one `HarnessSdkVersionMismatchError` on `core/internal`, called by all three; collisions
  are the one workspace `surface.collisions` cell this issue contributes the harness renames to;
  this issue owns the three harness *Surface* cells and their rows on the package-roots page.

**Open: none.**
