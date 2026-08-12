# Epic wrap detail — durable jobs & detached-task substrate (FIX-939)

Per-instance evidence behind [cycle 4 of the cycle ledger](../cycle-ledger.md#cycle-4--durable-jobs-epic-wrap-fix-939-2026-08-11).
The ledger carries the counts and the conclusion; the enumeration lives here so the
instrument stays scannable.

Merged 2026-08-11: [#1159](https://github.com/fixpoint-labs/flow-state-dev/pull/1159),
[#1173](https://github.com/fixpoint-labs/flow-state-dev/pull/1173),
[#1177](https://github.com/fixpoint-labs/flow-state-dev/pull/1177),
[#1180](https://github.com/fixpoint-labs/flow-state-dev/pull/1180),
[#1184](https://github.com/fixpoint-labs/flow-state-dev/pull/1184), under epic
[#993](https://github.com/fixpoint-labs/flow-state-dev/pull/993).

## `stale-restatement` — 5 caught in review, 4 escaped to `main`

**The escapes are the interesting half.** All four reached `main` and were closed by the
`polish-docs` pass dispatched at wrap ([#1246](https://github.com/fixpoint-labs/flow-state-dev/pull/1246)),
which verified each against the code independently and lists the same four.

| Where | The superseded answer it kept | How it ended |
|---|---|---|
| `packages/engine/src/resources/lineage-scope.ts` (file header) | the *rejected* derived-root design, naming `lineageRootSessionId` — a field that exists nowhere in source after `ac87ea9c6` replaced it with a minted `lineageId` | escaped review; closed by #1246 |
| `packages/engine/src/routes/recovery-routes.ts` (function doc) | "only auto-runs `detectInterruptedRequests` at server startup", after `f78fed0da` made it run on every runtime init | escaped review; closed by #1246 |
| `docs/architecture/state-and-scopes.md` | "Every creator goes through `ensureSessionRecord`" — three do not, and the child path structurally cannot, since it inherits `lineageId` rather than minting one | escaped review; closed by #1246 |
| `packages/bullmq/README.md` | *(omission rather than a false claim)* untouched since before the epic while owning three queue-specific facts the epic changed | escaped review; closed by #1246 |

The fourth is a different sub-shape from the first three and is counted but flagged: nothing
in it became false, it simply never moved. #1246 calls it the costly one — `worker-only` is
the natural place to start durable jobs and the one place the README never said they now work.

**Not a double count.** `state-and-scopes.md` appears both here and as a review finding on
#1180, but they are two different claims in one file: the review finding was that the section
documented the superseded root-ID-hash design (corrected during the PR), and the escape is the
separate "every creator" universal, which survived.

**The five caught in review:**

| PR | Instance |
|---|---|
| #1159 | `apps/docs/guides/background-work.md` — a detached worker "is validated and then still runs inline" |
| #1159 | `apps/docs/docs/server/background-work.md` — the shipped HTTP router wires no start operation |
| #1159 | the read-cost line, after `incarnationId` joined the claim ticket ("costs no extra read" → "neither costs an extra read") |
| #1177 | the `--model` scope — see below |
| #1180 | `state-and-scopes.md` documenting the superseded root-ID-hash design |

### The `--model` exemplar

One claim — that `--model` reaches every generator — corrected in **three commits over three
rounds across ~12 sites**: help text in three commands (`run`, `chat`, `dev`), two
`packages/cli/README.md` tables that mirror `--help` verbatim, and seven docs pages
(`cli/overview.md`, `cli/agent-dev-loop.md`, `cli/configuration.md`, `api/cli.md`,
`api/server.md`, `devtool/overview.md`, `devtool/setup.md`, `guides/development-tips.md`).

`45197d40d` records the tell: *"Three commands, not the two the review named — `dev` had the
same string, which fits it having been copied rather than written once."* The third was found
by searching for the string, not by re-reading the diff.

## `seam-correct-but-inert` — 6

A check placed correctly at the seam that is vacuous or dead end to end. Counted under
`missed-edge-case` in the ledger; enumerated here because the sub-shape is what the proposed
tenet 7 sharpening targets.

**Inert production code (4)** — the half no tenet or review lens reaches today:

| PR | Instance |
|---|---|
| #1180 | `retainOwnedKeys` provably returned `{}`: the fallback compared against `sessionKey` while the resolver assigns every newly shared key to the lineage address, so it discarded exactly the rows it existed to preserve |
| #1180 | `storageScopeOf` defined with zero call sites — execution and every HTTP route still passed `"session"` |
| #1180 | a widened callback signature `tsc` accepted while every call site kept passing a hardcoded `"session"`, because TypeScript lets a callback ignore extra parameters |
| #1180 | a coverage token written with the bucket and read without it, so two cache checks never hit and every repeated dispatch rescanned |

**Vacuous tests (2)** — tenet 7 asserts against these but supplies no method:

| PR | Instance |
|---|---|
| #1177 | a cancellation test that waited 300ms while the parent held its concurrency key for 400ms — it passed against the neutered fix, because the child had no chance to start either way |
| #1173 | a failed-read test that passed *against the bug*, because moving the initial state to `unknown` masked it; rewritten to drive a successful read first |

Two adjacent cases were caught by the same discipline and are worth recording as near-misses:
a queue-worker test whose first version asserted a dispatch handle while the Workstream never
ran (#1177), and an in-memory store whose reads and writes settle in the same microtask,
hiding a disposal race that only durable adapters expose (#1177).

### The counter-practice

The epic produced its own antidote and it is the most portable output of the wrap. #1177
published a **kill-count table** — neuter each fix in turn, record how many of its 17 tests go
red (13 for the single-owner install; 1 each for the pre-start abort registration, the
deadline, the ceiling fold, the shared arbiter, the envelope config) — and #1159 states that
every behavioural fix on that branch was neutered against its own test before being kept.

Its trap, worth naming alongside it: reverting a neuter with `git checkout <file>` discards
every uncommitted change in that file, not the one edit intended. Revert by replacing the
exact string.

## `carry-the-decision` — 5, plus a state-shaped twin

One rule implemented in two places that then drift; every fix the same move — compute once,
pass it along. Self-reported in #1180's body, which names the tell: *"where you see a
comparison deciding something a caller already knew, that is the shape to distrust."*

| # | The rule, implemented twice |
|---|---|
| 1 | the session-record overwrite guard (concurrent first actions minting different lineage ids) |
| 2 | session routing — collection CRUD routes selecting scope from the addressed declaration rather than the concrete key |
| 3 | session routing again — whole-scope reads classifying every matching key as shared without the exact-single/longest-prefix rule |
| 4 | task attribution inferred at the child rather than sent from the parent |
| 5 | the namespace decision recomputed by comparison in both `createExecutionContext` and the HTTP helper, which disagreed about where an unstamped session's shared bucket lives |

A sixth was raised by `cursor` on the duplicate `sharedAddressing()` walk and declined as
non-blocking follow-up; it is not counted.

**The state-shaped twin (1).** #1173's `error` + `truncation` split — one fact across two
independent values, so only a consumer holding both could state it correctly. It cost **three
rounds on one claim**, and `c84d5419a` records why: *"each of the previous two fixed the
consumer in front of us while the split kept producing another."*

## Zero callers in a framework — one episode, no trend

Recorded because the conclusion feeds a grounding proposal, not because it is a rework class.

Two review lenses argued from **in-repo usage counts**. `sharedToWorkstream` was called
overbuilt for having a single in-repo consumer (`apps/kitchen-sink`), when it is deliberate
framework configuration the roadmap needs — reasoning that would have confined a feature
before its consumers arrived.

The distinction that does hold is duplication, not usage. `parentTask` / `settleParentTask`
are on the public `RequestHost` type and documented in `packages/core/README.md` and
`state-and-scopes.md`, and are assigned nowhere — `createFlowState` says so in a comment, and
#1177 flagged it as an adjacent trap. Meanwhile `detached-runner.ts` already settles the
parent row by re-minting the claim ticket from the row its start gate re-read. That is a
second seam for a served capability, and it goes because it is a **duplicate route**, not
because nothing calls it.

#1246 independently found the same shape one layer down: `sessionResourceScopeId` has zero
callers, and `LineageSession.userId` plus the `tenantId` parameters are leftovers of the
rejected derived-address design.
