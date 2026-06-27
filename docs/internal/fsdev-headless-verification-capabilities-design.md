# Design proposal — `fsdev` headless-verification capabilities

**Date:** 2026-06-26
**Status:** PROPOSAL — for review. No engine/CLI change has been made.
**Origin:** spun out of the trading-desk headless lean-out (PR #651). The desk
work shipped fsdev-native (raw `fsdev run` + a read action); these are the
*framework* enhancements that would make headless verification ergonomic for
**any** app, not just the desk.

## The two ideas (separable, different risk)

An agent verifying a flow change wants two things `fsdev run` doesn't yet make
easy:

1. **Lean output** — write the verbose trace to a log; return only key info
   (session id, status, the result). Today stdout always carries the full NDJSON
   stream; `--quiet` only silences the *stderr* logs.
2. **Inspectable resource evidence** — read a run's resources as files. Today the
   discovery path already writes them (`createFilesystemStores` →
   `.fsdev/data/state/session/<id>/<key>`), but an app that pins a store in its
   `fsdev.config.*` (e.g. the desk's PGlite) can't opt a single run onto the file
   store.

---

## Capability A — lean output mode  (recommended first; low risk)

**Problem.** `fsdev run` emits NDJSON to stdout unconditionally
([run.ts:55-57](../../packages/cli/src/commands/run.ts#L55-L57)). `--quiet` only
suppresses the stderr `[flow-state]` logs. So "run it and read just the result"
means either `--capture <file>` (whose payload embeds the full `events[]` — 1.4 MB
for one desk run) or `… 2>/dev/null | jq`. Neither is "write verbose to a log,
return key info."

**Proposal.**
- `--log <file>` — redirect the NDJSON event stream to `<file>` instead of stdout.
- When `--log` is set, stdout returns a **compact run result** (one JSON object):
  `{ sessionId, status, success, durationMs, exitCode, output }`. That's the
  "only return key info" surface — directly `jq`-able, no stream to filter.
- `--capture <file>` stays the full structured payload for deep inspection.
- Optional follow-on: split the capture so `events[]` is opt-in (`--capture-events`)
  so the default capture isn't dominated by the trace.

**Why low risk.** Pure CLI/output concern, store-agnostic, no engine change. It
generalizes the pattern the desk skill teaches (`--capture` + read the file) into
a first-class affordance every app benefits from.

**Open question.** Does `status` belong in the compact result for a generic flow?
`fsdev run` only knows `success` vs error — "stopped vs completed" is app-specific
(it lives in resource state). So the generic compact result carries `success` +
`exitCode`; a richer `status` stays the job of an app read action (see Capability
C note).

---

## Capability B — `--store <filesystem|memory>` override  (useful, partial for the desk)

**Problem.** An app's `fsdev.config.*` pins a store. For the desk that's PGlite
(FIX-772), so a run's resources aren't file-inspectable. The CLI already has the
seam — `executeRunCommand` takes a `stores` override
([run.ts:273](../../packages/cli/src/commands/run.ts#L273)), and the discovery
path builds `createFilesystemStores`.

**Proposal.** `fsdev run --store filesystem[:<dir>]` (and `--store memory`)
overrides the config's store registry for that run, so framework resources land
as inspectable JSON at `.fsdev/data/state/session/<id>/<key>`.

**Caveats (verified this session).**
- **Partial for the desk.** The desk reads its portfolio repository **directly**
  via `getRepository()` ([portfolio-db.ts:105](../../labs/trading-desk/lib/portfolio-db.ts#L105)),
  not through the store registry. `seedSession` calls it, so PGlite still spins up
  regardless of `--store`. The override would relocate the *framework-store*
  resources (memos, decision snapshot) to files but leave the portfolio repo on
  PGlite — a two-backing split that diverges from how the app persists in prod.
  Fine for verifying *analysis logic*; not a faithful test of *persistence*.
- So `--store` is a genuinely useful **generic** capability (store-only apps get
  fully inspectable resources, no PGlite, concurrency-friendly), but the desk
  only half-benefits.

**Recommendation.** Worth doing, after Capability A, with the "verification store
≠ prod store" caveat documented. Decide the surface: a CLI flag (per-run, simple)
vs. a config-level "verification profile" (declarative, app opts in) — the flag is
the smaller step.

---

## Capability C — note on the read-action pattern (no new work proposed)

Even with file-inspectable resources, a **projection** (status, post-clamp
figures, an error rollup) beats re-deriving those from raw resource files. The
desk's zero-model `runSummary` action is that projection, and it's store-agnostic
— it works the same over PGlite or the file store. The lean-output + store
capabilities make resources *reachable*; an app read action makes them
*meaningful*. A generic framework "resource snapshot" mechanism could be explored
later, but the per-app read action is the right altitude today.

## Sequencing

1. **Capability A** (lean output) — highest value, lowest risk, store-agnostic.
2. **Capability B** (`--store` override) — generic win, document the desk caveat.
3. Batch sweeps / scoreboards stay out of scope → the eval-suite (FIX-790).

## Out of scope
- Decoupling the desk's portfolio repository from its Postgres backing (a larger
  FIX-772 change; not required for analysis-logic verification).
- Any change in this PR — this is a proposal to review before engine/CLI work.
