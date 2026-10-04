# FIX-1278 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Scope comes from the fsd-architect's fence on the issue: "validator parity + fix first-run
hits; don't merge into FIX-1277 ticket (independent)." The desk constraint adds that first-run
fixes must preserve behaviour. A hit that needs a behaviour or public-API change is not fixed
here.

<a name="d1"></a>
## D1 · Postgres gets its own rule, which allows engine runtime imports, and the script says why

`store-postgres` goes into the validator with the same `allow` and `deny` sets as
`store-sqlite`, and an empty `typeOnly`. A comment above the rule names the one difference and
its reason: Postgres takes its trace store and its live-tail helpers from the engine at
runtime, while SQLite keeps local copies.

- **Instead of:** copying `store-sqlite`'s rule word for word (`typeOnly: engine`) and making
  the two first-run hits pass by rewriting Postgres. That means copying
  `createInMemoryTraceStore` and eight live-tail helpers into the package, and replacing the
  thrown `StoreSubscriptionError` with a local error class. Callers that check
  `instanceof StoreSubscriptionError`, or catch it as a `FlowError`, would stop matching. That
  is a behaviour change, and the copies are the kind of drift FIX-1277 exists to remove.
- **Because:** the issue offers exactly this branch ("or the asymmetry is explained, if there
  turns out to be a real reason for it"), and the reason is real. Postgres already declares
  `@flow-state-dev/engine` as a runtime dependency and already imports its runtime code. No
  locked contract in `docs/architecture/overview.md` makes store adapters type-only; that is
  a choice `store-sqlite`'s rule makes on its own. Tenet 7 applies too: a guard should check
  what the package actually is, and never have its bar lowered or raised so a run goes green.
- **Locks in:** the two adapters differ on one axis, and the script records that. A new
  engine runtime import in Postgres passes. Anything that reaches for `client` or `react`, any
  import of a workspace package outside `allow`, and any cycle all fail, the same as SQLite.
- **Flips if:** you want both adapters type-only on the engine as a rule. Then this issue
  still lands as written, and the Postgres rewrite becomes its own issue. That issue would be
  sequenced after FIX-1277, which may give it a shared home (`contracts`) for the helpers, and
  it would own the `StoreSubscriptionError` change.

## Engineering calls

- **E1 · `store-postgres` joins `contracts`' deny set,** next to `store-sqlite`. `contracts`
  already allows nothing, so the only change is the clearer "forbidden import" message.
- **E2 · Every comment that says Postgres can't import the engine is fixed here, not left to
  FIX-1277.** Eight sites across `store-postgres/src` and `engine/src/stores` say so
  ([PLAN → S2](PLAN.md#surface)). Once this lands they are false for Postgres, and the script
  contradicts them. Fixing only some would leave SPEC's "reads a claim that matches the script"
  row untrue. Skip any site FIX-1277 has already deleted or rewritten.
- **E3 · No self-test for the script.** The repo has none for this validator, and the
  plant-and-reject check in the plan proves the new rule is reached. A standing test would be
  a new pattern. That belongs to a broader validator issue, not a parity fix.
- **E4 · `vercel` and `scheduled` stay outside the package list.** `vercel` imports
  `store-postgres` and both adapters import `scheduled`. The issue puts extending the validator
  to other packages out of scope. One consequence, the same for both adapters: the cycle check
  only sees listed packages, so a cycle through `scheduled` or `vercel` goes unreported. BR-3
  and SPEC say so rather than promise more.
- **E5 · No POC or fact-checker.** The spec's factual base is two validator runs, and
  [PLAN → Checks](PLAN.md#checks) repeats them. The first-run hit list is the output of the
  mirrored-rule run, pasted verbatim.

## Open

None.

## Settled

- **The first-run hit set** under a word-for-word copy of `store-sqlite`'s rule is exactly two
  files: `store-postgres/src/index.ts` and `store-postgres/src/request-store.ts`. Both hits are
  "must be type-only" for `@flow-state-dev/engine`. Under D1's rule the run is clean. A planted
  `@flow-state-dev/react` import in `store-postgres/src` fails the D1-rule validator (exit 1,
  both "forbidden" and "not allowed"), while the same plant passes today's script (exit 0).
  Run on `origin/main` @ `67a3bb9b3`.
- **The S2 comment sites.** `grep -rn -i "type-only"` over `store-postgres/src` and
  `engine/src/stores` on `4cc9e8b1c` finds eight comments that cover Postgres (listed in
  [PLAN → S2](PLAN.md#surface)) and one in `scope-keys.ts` (~L293) that names SQLite alone.
- **The cycle check sees listed packages only.** `resolveWorkspacePackage` returns `undefined`
  for anything outside `packages`, so those edges never enter the graph.

## How it got here

- **Draft:** framed as closing an unchecked adapter. The validator was extended in a scratch
  copy and run both ways, and the only mirrored-rule hits turned out to be deliberate runtime
  dependencies. The issue's "explain the asymmetry" branch was chosen over a behaviour-changing
  rewrite. One tooling PR, plus two comment corrections. Figures were cut as out of proportion,
  leaving one mermaid for the goal check.
- **Review round 1:** two claims promised more than the design delivered. S2 named two comments
  where eight make the same false claim, so S2 now covers all eight. The cycle guarantee held
  only among listed packages, so BR-3 and SPEC now say that. D1 is unchanged. Optional notes
  went to [PLAN → Notes from review](PLAN.md#notes-from-review).
