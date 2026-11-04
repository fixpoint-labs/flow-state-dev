# FIX-2490 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls that sit above any single child: what was chosen, what lost, why, and what each locks
in for the ten children and the closure. D1 to D3 are the owner's, made before this spec was
written. D4 and D5 are engineering calls. Q1 is the owner's, answered on Nov 4.

<a name="d1"></a>
## D1 · New layers are on by default for every workforce worker, each with its own opt-out

| | |
|---|---|
| **Instead of** | An opt-in preset that our four apps turn on and outside apps never see |
| **Because** | The outcome is "without each app writing that guidance itself". A preset each app must find and switch on is a fifth thing every app writes. Pre-1.0, a behaviour change for existing workforce users is accepted (the owner's call, before this draft) |
| **Locks in** | Every workforce worker, ours or not, gets each section and pays its tokens every turn. Each section needs an opt-out ([ER-1](#who-owns-what)). The skills switches' "zero-configuration costs nothing" rule is reversed for the index |

**What would change my mind:** wanting workforce to stay unopinionated for outside users. Then
it is a preset, and our apps turn it on.

![D1, whether new layers are on by default: on with an opt-out per layer, chosen, beside an opt-in preset. Decides it: an app gets the guidance without writing anything. Price: every worker pays the tokens, and existing users see a change. Flips if workforce should stay unopinionated](figures/d1-on-by-default.svg)

<a name="d2"></a>
## D2 · No eval apparatus: the closure check is the proof, and its cut run decides what is built

| | |
|---|---|
| **Instead of** | A before/after eval of about 10 scripted tasks per app, scored by a judge, before any layer or content change |
| **Because** | The four closure scripts have to exist anyway. Run once after the six bugs merge, they show which asks the wiring alone fixed, which is the question the eval was for. The owner's call, before this draft |
| **Locks in** | Bugs first. The closure's scripts are built early, as its spec POC, so the cut run can happen before the closure is unblocked; no separate end-state POC is built. Each bug blocks each layer in Linear. A layer whose ask passes on the cut run is cancelled, citing the run ([ER-6](#who-owns-what)). "Smarter" outside the seven asks is not measured |

**What would change my mind:** a cut run that can't tell the layers apart, because every ask
passes or fails the same either way. Then the asks are too coarse, and a finer check is worth
its cost.

![D2, how we know a layer is needed: the closure scripts, run after the bugs, chosen, beside a before and after eval. Decides it: the scripts exist anyway and answer which asks the bugs alone fixed. Price: seven asks, not a quality score. Flips if the cut run can't tell the layers apart](figures/d2-cut-run.svg)

<a name="d3"></a>
## D3 · Tool-owned guidance stays its own issue (FIX-2499)

| | |
|---|---|
| **Instead of** | Folding it into FIX-2496 as edits to the search, fetch and project-source descriptions (the coordinator's proposal) |
| **Because** | A description is printed for every tool in the list, so hints about other tools name tools a worker may not hold. A line shown only when the tool is held, and a cross-tool hint only when both are, is what the compared harnesses do. The owner's call, before this draft |
| **Locks in** | A core change, under [D4](#d4)'s rule: a tool with no guidance line prints as it does today. FIX-2499 is still under the kill line: if FIX-2496 alone passes the knowledge ask, it is cut |

**What would change my mind:** the cut run passing the knowledge ask with FIX-2496 alone. Then
the kill line cuts it, and that is the decision working, not reversing.

![D3, where tool guidance lives: a guidance line shown only when the tool is held, chosen, beside longer descriptions. Decides it: hints that name a tool the worker doesn't hold. Price: a core change and its own spec. Flips if FIX-2496 alone passes the knowledge ask](figures/d3-tool-guidance.svg)

<a name="d4"></a>
## D4 · Defaults live in workforce's worker flow as named sections; core gains mechanism only

| | |
|---|---|
| **Instead of** | Defaults in core's generator, so every app gets them, workforce or not · or each layer as its own prompt entry or capability |
| **Because** | [FIX-2369 ER-2](../FIX-2369/DECISIONS.md#who-owns-what) keeps the generator unopinionated, and that holds. The seam in `agent-worker-flow.ts` says an org-wide layer of configurable text is where the seam is re-decided rather than widened; per-layer opt-outs are that point. Named sections fix the "where does TEAM.md end" problem the analysis found |
| **Locks in** | One ordered list of named sections, each a fixed text with an opt-out, owned by FIX-2498 and built as one module (`workerDefaultLayer`) that is the prompt array's single default entry. Opt-outs are one `defaults` key in the worker-config bag (`workerConfigSchema`), and `defaults: false` turns every section off; no new `defineAgentWorkerFlow` option. The layer reaches workers built without an installation; only identity, which reads the roster, still needs one. No registry, no app-supplied section text. The one core change (FIX-2499) is a no-op for a caller that sets nothing new |

Engineering, not asked: it moves no product outcome, and the sign-off's D1 already fixes who
gets the defaults.

<a name="d5"></a>
## D5 · The coding brief takes its checks from `commandCheck`; the code decides done, not the report

| | |
|---|---|
| **Instead of** | The brief carrying its own list of checks for the coder to run |
| **Because** | `commandCheck` (`packages/harness-manager/src/command-check.ts`, on `main` since b6c629686) already runs a project's commands on the run's checkout and records the result. A second list drifts, and a coder's "tests passed" is a claim ([BP-003](../../../docs/contributing/best-practices.md)) |
| **Locks in** | FIX-2502's brief reads its checks from `commandCheck`'s own `commands` option, so there is one list by construction. The closure's coder leg checks the report against that record |

Engineering, not asked: one list of checks is the only answer the compose rule allows.

<a name="q1"></a>
## Q1 · Resolved · The proof reaches every layer the epic builds: three more asks in the closure

**The owner's call, Nov 4 (in session).** FIX-2541's scripts gain three asks beside the four
they had: **(1)** a one-line question gets a short answer; **(2)** a worker holding a skill that
fits loads it without a slash; **(3)** a decision made before a summary fold is still used after
it, in the two labs, where conversations run long. Each runs 3 times and passes on 3 of 3, with
a control that fails on the pinned pre-bug `main` ([ER-7](#who-owns-what)). Still each app on its
real path, still no eval apparatus ([D2](#d2)).

| | |
|---|---|
| **Instead of** | Moving FIX-2500 and FIX-2498's skills-index section to *Not doing*, the alternative argued in the [second look](https://github.com/fixpoint-labs/flow-state-dev/pull/4672#issuecomment-6631454763) |
| **Because** | Under the kill line a layer no ask reaches can be neither cut at the cut run nor proven at the wrap, so it ships unmeasured, which is what D2 exists to stop. The owner kept "keeps the thread" and "sees its skills" in the outcome |
| **Locks in** | FIX-2500 and the skills-index section stay in scope, and are now cuttable and provable: the cut run cancels either one whose ask already passes ([ER-6](#who-owns-what)), and the wrap proves the rest. Answer sizing, in FIX-2498's behaviour section, gets its own ask. FIX-2541's spec and Linear description carry the seven asks. The seeded long conversation is the larger part of the cost, two to three days rather than one. Each new ask asserts its mechanism fired, and the cut run switches on today's skills listing and uses Teammates' existing fold, so the ask measures the content; a cut keeps the default flip ([ER-6, ER-7](#who-owns-what)) |

**What would change my mind:** compaction or skills dropped from the outcome on purpose. Then
they move to *Not doing*, and their asks go with them.

![Q1, decided: three more asserts in FIX-2541's scripts, chosen, beside moving the summary and skills index out. Decides it: a layer with no ask can neither be cut nor proven. Price: two to three days more proof. Flips if compaction and skills were dropped from the outcome on purpose](figures/open-proof-reach.svg)

## Who owns what

![Who owns what: eight rules by owner. FIX-2498 owns the section shape and its one opt-out key, used by FIX-2500 and the closure; FIX-2499 owns core staying neutral; FIX-2502 owns one list of checks, from commandCheck; FIX-2494 owns appending to presets; each child owns deleting the patch it replaces; the coordinator owns the cut run and consumed issues; the closure owns how its scripts assert, 3 of 3 runs. Each rule has one owner](figures/ownership.svg)

Every rule has one owner. Read a row to see where a decision is made and where it is only
consumed; a *uses* cell is a place a child must not re-decide.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | Every new layer is a named section of workforce's default layer (`workerDefaultLayer`), on by default, with its own opt-out ([D1](#d1), [D4](#d4)). Opt-outs are one `defaults` key in the worker-config bag (`defaults: { environment: false }`); `defaults: false` turns them all off. The fixed sections stay under a published ceiling of 400 tokens (1,600 characters), the estimate of about 250 plus a margin, with a test that fails past it; identity, the summary's content and each skill's entry are outside it. No section is a capability, a registry entry or app-supplied text | FIX-2498 decides · FIX-2500 consumes | The spec-set review |
| ER-2 | Core gains mechanism, not defaults. A core change is a no-op for a caller that sets nothing new; workforce's worker flow is where it turns on | FIX-2499 | FIX-2499's spec review |
| ER-3 | A layer that replaces an app's own patch deletes that patch in the same change: an app's length line, a hand-built coding prompt. Kitchen Sink's `todaysDate` goes only in the change that makes its standalone assistant compose the exported environment formatter | Each child | The closure's sweep |
| ER-4 | The coding brief's "check before done" takes its checks from `commandCheck`'s own `commands` option. No second list; the report is never the verdict ([D5](#d5)) | FIX-2502 · FIX-2494, 2495 consume | FIX-2502's spec review; the closure's coder leg |
| ER-5 | A harness's own preset is appended to, never replaced | FIX-2494 builds · FIX-2502 consumes | FIX-2502's spec review |
| ER-6 | No layer is implemented before the cut run reports on the closure issue. A layer, or a section of FIX-2498, whose ask passes 3 of 3 is cancelled or dropped, citing the run ([D2](#d2)). The environment section is exempt and kept regardless: only Kitchen Sink gets a date from the bugs. A cut of the skills index or the summary drops its content and keeps its default flip ([D1](#d1)): the wrap sets no switch | The coordinator | Each wake |
| ER-7 | The closure's scripts serve each app as it ships and drive it over its public API, as the existing goals for these apps do, and assert on the worker's answer on a real model, each with a control that fails on `0df5c85` (`main` before the bug fixes, pinned). Each ask runs 3 times and passes only on 3 of 3; a control fails if any run fails, and each ask must fail its control in at least one app where it runs. An ask that needs a mechanism to fire (a summary fold, a held skill) asserts it fired first; a run where it did not fails. "Where it runs" means where the ask's precondition can hold: the Claude Code-style lab has no fold on `main`, so it runs the fold ask only at the wrap, and FIX-2500's cut is read on Teammates alone. The control and the cut run turn on today's skills listing; the wrap sets no switch | FIX-2541 | The closure's spec review |
| ER-8 | Consumed issues keep their parents: FIX-2387 and FIX-2388 (FIX-2369), FIX-2174 (FIX-2171), FIX-2467, FIX-2073 | The coordinator | Each refresh |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `agent-worker-flow.ts` prompt array, `worker-identity.ts`, `workerConfigSchema` | FIX-2491, 2493, 2498, 2500, and FIX-2073 | The bugs land first: FIX-2491's step default, and FIX-2493 so every later section reaches the EM. FIX-2498 makes `workerDefaultLayer` the array's one default entry and replaces the seam's "do not grow" comment; FIX-2500 adds a section to that module, not to the array. FIX-2073's line goes in the behaviour section |
| `labs/teammates/src/flows/coder.ts` | FIX-2495, FIX-2502, and FIX-2369's merge order on that file | FIX-2495's local fix first; FIX-2502 replaces the builder. FIX-2369's [build order](../FIX-2369/DECISIONS.md#coordination-seams) row for this file governs the merge order |
| `packages/shift-manager/teams/devteam/harness.mts` | FIX-2494, FIX-2502 | FIX-2494 switches to the preset with appended text; FIX-2502 swaps that text for the brief |
| harness-manager's `buildPrompt` | FIX-2502, FIX-2388 | The brief composes `heldPromptSection`, `PromptRunContext.task` and FIX-2388's issue section, and reads `commandCheck`'s `commands` |
| Search, fetch and project-source tools | FIX-2496, FIX-2499 | FIX-2496 wires them with today's descriptions; FIX-2499 adds their guidance fields |
| Kitchen Sink chat agent's date | FIX-2492, FIX-2498 | The assistant is a standalone core generator, not a worker, so the section never reaches it. FIX-2492's per-turn date stays until FIX-2498 exports the environment formatter and has the assistant compose it; that change deletes the local fix (ER-3) |

## Decided in review, recorded so no child reopens them

- **FIX-2496 stays on the direct route.** It wires existing tools (`search`, `fetch`, workforce's
  project source) to two workers. Which tool reaches `apps/docs` is its implementer's call.
- **FIX-2500 does not wait for FIX-2174.** It supplies the summary to the existing fold; FIX-2174's
  triggers, overflow retry and manual compact are not needed for the goal.

Round 1, from the analyst and `reuse-review` on e99e96f:

- **FIX-2497 and FIX-2501 fold into FIX-2498** (PM restraint cut). Environment is a constant
  beside `TOOL_USE_RULE`; the index is a default flip on `createSkillsLibrary`. Each keeps its
  own opt-out, so the kill line still cuts one alone. Both are Duplicate in Linear.
- **The step budget is a workforce default** (analysis #1, EM). FIX-2491 raises it to about 50
  for every worker; the closure's knowledge ask needs several lookups.
- **3 runs per ask, 3 of 3 to pass** (analysis #2, EM). In ER-6 and ER-7.
- **D5 no longer waits for FIX-2387** (analysis #4). `commandCheck` is on `main`.
- **One opt-out shape** (analysis #5, reuse, EM). A `defaults` key, ER-1.
- **Reuse, not new** (reuse-review). FIX-2499 extends the `<tools>` list with a field, neither
  superseding nor reducing it; FIX-2500 reuses `historySummary`, so ER-2 is FIX-2499's alone;
  FIX-2502 composes. The SPEC's Adds table has the pieces.

Round 2, from the [second look](https://github.com/fixpoint-labs/flow-state-dev/pull/4672#issuecomment-6631454763)
and Codex's [review of DECISIONS.md](https://github.com/fixpoint-labs/flow-state-dev/pull/4672#discussion_r4468037697) on 5a275b3, EM calls:

- **The environment section skips the cut run** (second look #1). FIX-2492 dates Kitchen Sink
  only; the other three apps have no date at all, and the section is the first outcome bullet.
  In ER-6.
- **The coder leg asserts on `commandCheck`'s record** (#1). The run record's `checks`; the
  SPEC's verify table says exactly what passes, and that the cut run is expected to fail it.
- **A master off switch** (#3). `defaults: false` in the same key, owned by FIX-2498. No new
  flow option. ER-1.
- **A published token ceiling** (#3). 400 tokens for the fixed sections, the estimate of about
  250 plus a margin, with a failing test; FIX-2498 owns it. ER-1.
- **Changesets** (#3, implementer note). FIX-2498, 2499, 2500 and 2502 each add one for every
  published package whose default behaviour changes (BP-022); workforce at least.
- **Workers built without an installation get the layer** (#4). Today they get no identity
  layer (`agent-worker-flow.ts`, the prompt array's first entry). FIX-2498's sections reach
  them; identity still needs the roster. In FIX-2498's scope here and in Linear.
- **One deep module** (#4, implementer note on FIX-2498). `workerDefaultLayer` owns section
  order, the opt-outs and the "`undefined`, never `""`" rule; the array keeps one entry for it.
- **Kitchen Sink's date stays until its assistant composes the shared formatter** (#5 and
  Codex). The assistant is a standalone core `generator`, not a worker, so the environment
  section never reaches it. FIX-2498 exports the formatter and has the assistant compose it,
  deleting FIX-2492's fix in that change. ER-3 and the seam.
- **Q1's alternative priced on its card** (the second look). The owner answered it after merge;
  see [Q1](#q1).

On Q1's amendment, from the [second look on #4703](https://github.com/fixpoint-labs/flow-state-dev/pull/4703#issuecomment-6641038965)
(three findings that decide whether the kill line can cut the layers Q1 added), EM calls:

- **No vacuous pass** (#1). The fold ask finds a fold in the run record before it checks the
  decision; the skill ask finds the skill held. A run where the mechanism did not fire fails, so
  it can never cancel FIX-2500 or the index. ER-7.
- **The cut run switches on what `main` has** (#1, #2). Today's `historySummary` fold in both
  labs (narrowed to Teammates by [FIX-2541's alignment](#on-fix-2541s-alignment)), and
  `skills.activateTool` with a fitting skill held, so each ask tests the layer's content against the existing mechanism rather than failing by construction. A cut drops the
  content and keeps the default flip, because the wrap sets no switch. ER-6, ER-7.
- **The control is per ask** (#4). Each ask must fail on `main` in an app where it runs; "one
  ask fails in every app" no longer showed that the new asks can fail. ER-7.
- **Routed, not folded** (#3 and the fixture note). The sizing ask's pass criterion and a shared
  seeded-conversation fixture are FIX-2541's, which owns how its scripts assert (ER-7).

<a name="on-fix-2541s-alignment"></a>
On FIX-2541's alignment: the owner approved the closure's spec by merging
[#4711](https://github.com/fixpoint-labs/flow-state-dev/pull/4711) (head 0c048b4), and the FSD
Architect's coherence comments on it
([fork](https://github.com/fixpoint-labs/flow-state-dev/pull/4711#issuecomment-6642090061),
[epic vs spec](https://github.com/fixpoint-labs/flow-state-dev/pull/4711#issuecomment-6642092355))
named three places this epic said otherwise. The epic now follows the child:

- **The summary's cut is decided on Teammates alone** (Switches, leg c3). The Claude Code-style
  lab has no summary fold and no switch on `main`, so its fold ask could only fail its
  precondition on the control and the cut run. It runs that ask at the wrap only, where
  FIX-2500's default must carry it. "Every app where it runs" means every app where the ask's
  precondition can hold, so FIX-2541's [D1](../../issues/FIX-2541/DECISIONS.md#d1) is read
  plainly, with no exception. ER-6's cut-keeps-flip and this epic's D1 are unchanged. ER-7.
- **The real path is each app served as it ships, driven over its public API** (goal check). One
  `fsdev run` process does not host a turn that spans sessions and a coding run; every existing
  goal for these apps serves the app and drives it through its client. The asks and their pass
  criteria are unchanged. ER-7.
- **The control is pinned to `0df5c85`**, `main` before the bug fixes, instead of "today's
  `main`", which moves as children merge and could let a control pass for the wrong reason.
  ER-7.

## How it got here

- **Filed (Nov 2)** — epic and twelve children from the harness comparison. D1 to D3 settled
  with the owner, who overruled folding FIX-2499 into FIX-2496.
- **Drafted (Nov 4)** — the closure FIX-2541 filed; bugs wired to block every layer for the cut
  run; Q1 raised.
- **Review round 1 (Nov 4)** — analysed; two children folded; the calls above.
- **Review round 2 (Nov 4)** — the second look and Codex folded; Q1's alternative priced.
- **Merged (Nov 4).** The owner then answered [Q1](#q1): three more asks in the closure; FIX-2500
  and the skills index stay. Folded by a follow-up amendment PR (#4703).
- **Amendment review (Nov 4)** — #4703's second look: the new asks can't pass vacuously, the cut
  run switches on today's mechanisms, the control is per ask. A second amendment PR.
- **FIX-2541 aligned (Nov 4)** — the owner merged the closure's spec (#4711). The epic follows
  it: the summary's cut on Teammates alone, the apps on their real path, the control pinned to
  `0df5c85`. A third amendment PR.

**Open:** none.
