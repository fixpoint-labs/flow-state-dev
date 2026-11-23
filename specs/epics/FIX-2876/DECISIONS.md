# FIX-2876 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls above any single issue, and what each locks in for the four children and the closure.
D2 and D3 answer the questions FIX-2878 and FIX-2879 put to the owner, as recommendations. D3
also reaches into a sibling epic, FIX-2616, and names two of its issues as readers of the carrier.
Five calls the owner and the engineering manager already made, the owner's later call on modes,
and the engineering manager's corrections after them, are in [Decided in review](#decided-in-review); the cards and rules below
carry them.

## The tree

```mermaid
flowchart TD
  E["FIX-2876"] --> D1["D1 · four issues and a closure, after the release"]
  D1 -.->|"rejected"| X1["only the cleanup"]
  E --> D2["D2 · one coder worker · harness: is its default"]
  D2 -.->|"rejected"| X2["one worker per harness"]
  E --> D3["D3 · the lab's choice uses this carrier"]
  D3 -.->|"rejected"| X3["FIX-2598 builds its own first"]
```

<a name="d1"></a>
## D1 · One way to pick a coder is worth four issues and a closure, after the release

| | |
|---|---|
| **Instead of** | Only the cleanup (FIX-2877): one flow and one default, with the pick still in message text |
| **Because** | A picked model never reaches a coding task today, and switching coder means cancelling and refiling to another worker. The cleanup merges knobs but leaves both. Eleven places pick a coder ([SPEC](SPEC.md#whats-already-here-and-the-debt)); goal 4 asks us to close that, not shrink it |
| **Locks in** | Run settings are fields of the coder flow's declared task input; later settings join that schema. The input is `codingTaskInput { harness?, model?, plan?, mode?, issue?, project? }` (in code the zod value is `codingTaskInputSchema`, its type `CodingTaskInput`, per the repo's convention): `input.project` moves into it, `mode` and `issue` replace the `harnessFeature` marker (a legacy marker is read as `mode: "implement"`, [ER-9](#who-owns-what)), and the namespacing goes; `mode` names one of the modes the app registers on the harness kit ([ER-1](#who-owns-what), [the modes call](#decided-in-review)); `plan` is the plan run setting, server-owned from the start ([ER-10](#who-owns-what)), on `codingTaskInput` and on `codeWith`, and inert until FIX-2599: `claude-code-plan` stays the boundary, and before then `plan` only refuses a mismatch ([ER-2](#who-owns-what)). A task input is declared and checked by [FIX-2894](https://linear.app/fixpoint-labs/issue/FIX-2894) ([ER-9](#who-owns-what)), which blocks FIX-2878. Owner's call, [Q-A and Q-B](#decided-in-review) |

**What would change my mind:** evidence that nobody switches coder or model per task. Then one
default per app is enough, FIX-2878 and FIX-2879 go, and FIX-2877 ships alone (FIX-2894 stands
on its own as typed task input).

![D1: four issues and a closure, chosen, beside only the cleanup. Decides it: a task says how it runs, so a model reaches the run. Price: an epic and four package changes. Locks in run settings as fields of the coder flow's declared task input. Flips if nobody switches coder or model per task](figures/d1-worth-it.svg)

It comes down to the task: without run settings, the harness stays fixed per worker and the model never arrives.

<a name="d2"></a>
## D2 · Teammates keeps one coder worker; a worker's `harness:` is only its default

| | |
|---|---|
| **Instead of** | One coding worker per harness (`teammates.claude-code`, `.codex`, `.cursor`), as today |
| **Because** | Once a task names its harness, the three workers differ by one line, and switching coder means cancelling and refiling to another worker. With one worker, the next request names the coder and goes to the same worker. A run in flight keeps the coder it started with ([ER-2](#who-owns-what)), and a new coder is a new task with a fresh session ([ER-8](#who-owns-what)) |
| **Locks in** | The task card and run report show the harness and model the run used, read from the run ([ER-2](#who-owns-what)). A worker that must not change coder declares its harness, and its plan setting, locked, and a request naming another is refused by name ([ER-11](#who-owns-what)); Teammates' one coder is not locked. FIX-2879 collapses the workers, since that is when the pick reaches the task without text. FIX-2877 only removes the fallback copies. The lab's own worker ids stay FIX-2598's |

**What would change my mind:** people choosing a coder by its roster row rather than on the
request. Then the per-harness rows stay as presets, still overridable by a task.

![D2: one coder worker whose harness line is its default, chosen, beside one worker per harness. Decides it: switching coder, by naming it on the next request to the same worker rather than refiling to another worker. Price: which coder ran is read off the task card, not the roster. Flips if people pick a coder by its roster row](figures/d2-one-coder.svg)

It comes down to switching: one worker turns refiling to another worker into a pick on the next request.

<a name="d3"></a>
## D3 · The Claude Code-style lab's choice travels through this epic's carrier; FIX-2598 waits for FIX-2879's package half

| | |
|---|---|
| **Instead of** | FIX-2598 settles where the lab's pick lives, as [FIX-2616 ER-2](../FIX-2616/DECISIONS.md#who-owns-what) leaves it, and builds that first |
| **Because** | FIX-2879 builds a carrier in the workforce kit for Teammates. Two carriers built in parallel end with one rewritten onto the other. FIX-2616 ER-2 expected this: "a package change is a child that blocks it" |
| **Locks in** | FIX-2598 waits only for FIX-2879's **package half**: the `codeWith` session field and the harness kit's filler reading it at filing, not its Teammates worker collapse ([D2](#d2)). FIX-2879 splits along that line, a planned split the spec-set author makes; the package half blocks FIX-2598 in Linear (FIX-2878 is implied through it). The carrier has two readers in FIX-2616. **FIX-2598** writes the person's harness and model through it, and removes the lab's `Coder:` line in the same PR as the lab's eight per-harness workers, so the lab never has the line gone while the workers remain. **FIX-2599** reconciles plan mode: the lab's `claude-code-plan` harness id becomes the plan run setting, the `plan` field this set adds to `codingTaskInput` server-owned ([ER-10](#who-owns-what)), never a second store. FIX-2599 moves plan mode off the harness id only once this set includes that field; until then `claude-code-plan` stays a harness id. What plan mode a harness offers stays FIX-2597's ([FIX-2616 ER-1](../FIX-2616/DECISIONS.md#who-owns-what)). A PR on FIX-2616 records that ER-2's placement is answered here. It opens with this epic's approval and merges before any child's implementation starts, so FIX-2598's readers never meet two ownership stories |

**What would change my mind:** the lab needing its model picker before this epic's release
window. Then FIX-2598 goes first with the smallest carrier it can, and FIX-2879 adopts it.

![D3: the lab's choice through this epic's carrier, FIX-2598 waiting, chosen, beside FIX-2598 building its own first. Decides it: one carrier at the end, against two until one is rewritten. Price: the lab's model picker waits for FIX-2879's package half, and FIX-2616 ER-2 is amended. Locks in: FIX-2598 drops the Coder: line with its eight workers, and FIX-2599 reads the carrier. Flips if the picker is needed before the release](figures/d3-one-carrier.svg)

It comes down to carriers: building both in parallel ends with one of them rewritten.

## Who owns what

![Who owns what: twelve rules by FIX-2894, FIX-2877, FIX-2878, FIX-2879, the closure FIX-2883 and the coordinator, each rule with exactly one builds or decides cell](figures/ownership.svg)

Every rule has one owner. A *uses* cell is a place a child must not decide the rule again.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | One coding worker flow: the harness kit's `coder`. No app in this repo forks it; Shift Manager's `coder.mts` goes. What an app needs is an option or a slot on that flow. **What kinds of run an app offers is the kit's `modes` option**, never `phases`: a name maps to a mode, `{ instructions, doneWhen, workspace }`, plus the task-input fields it `requires` ([ER-9](#who-owns-what) checks them), where `instructions` builds the run's prompt (today `PhaseSpec.buildPrompt`), `doneWhen` is the server-side done check (today `PhaseSpec.isDone`, with its `validate` and `doneTimeoutMs`), and `workspace` is where the run works (a repo checkout on a branch, a scratch host, a project workspace host). With no `modes` the kit has one mode, `default`, today's single phase; an app may override parts of it (`modes: { default: { instructions } }`) and keeps the kit's `doneWhen` and workspace. A task with no `mode` runs the kit's `defaultMode` (absent: `default`; Shift Manager sets `"answer"`). `PhaseSpec` becomes `ModeSpec` with those field names, `PhaseDoneVerdict` becomes `ModeDoneVerdict`, `codingPhase` becomes `codingMode`, and the run record's topic segment `phase` becomes `mode`; the old exported names go with no alias (BP-034), and a changeset records it (minor). Until FIX-2878 adds `mode` to the task, a `harnessFeature` marker selects `implement` and its absence the app's default mode | FIX-2877 | FIX-2878's and FIX-2879's spec review; closure leg c |
| ER-2 | One order, written once in the coder flow. **A harness:** the task's run settings (`harness` in `codingTaskInput`), then the worker's config, then the kit default. **A model:** the task's `model`, then the harness value's own default (for example `cursorHarness({ model })`); there is no worker-config model and no kit-default model. **Plan:** the task's `plan`; with none, a run is a plan run only if its harness id is one (until FIX-2599, `claude-code-plan`). **Until FIX-2599, `plan` never loosens the harness id's boundary**: a resolved `plan: true` on a harness that is not a plan harness fails the claim by name, and a plan harness with `plan` false or null still runs, and is frozen, as a plan run. **The order runs once per task, at the first claim**, and every later attempt keeps what it chose ([FIX-2878 D1](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md#d1)). The claim freezes the three run settings, the resolved harness id, model and plan setting, as one triple, **plus the worker's `review` mode and the task's `mode`** (as stored: filing already wrote the app's `defaultMode` into a task that named none, [ER-9](#who-owns-what); the claim never resolves a default), on the run record (`run-record.ts`), beside `sessionId`, as nullable fields with default null (BP-030). The frozen value is harness, effective model, plan, review and mode; every route reads it. Only the three run settings are carried or inherited into a child filing ([ER-10](#who-owns-what)); `review` and `mode` are never inherited: a child takes its own worker's `review`, and its own `mode` or the app's default. **The frozen model is the effective one**, the harness's own default included, read from the harness's `defaultModel` (a small `Harness` addition, FIX-2878's); it is never a null that falls through to whatever the harness option says later. So a retry and an inherited child filing run the frozen model even if the app later changes `cursorHarness({ model })`. Only a fresh work claim runs the order. **Every other route the coder flow has reads that frozen triple**: a steer, a delivered message, the door and a resume. None reads the session's current `codeWith`, and none routes by the session's worker alone, as `harnessOf` and `byHarness` in `coder-flow.ts` do today. After the first claim, neither `updateTask`, a steer nor a retry changes harness, model, plan or `review`; the only path to a different coder is a new task. A harness is checked against the filled harnesses; a refused harness fails the task at once, names what is allowed, and never runs on something else. A named model runs only when that harness's `models()` returned `status: "models"` and the whole selection, Cursor's id and params included, is a listed entry. Otherwise the model is refused by name and the run uses the harness default; no catalog, a failed catalog and an unlisted param are all refusals. What ran, and any refusal, is read from the run, never from the pick | FIX-2878 | FIX-2879's spec review; closure legs a, b, c and d, with b's steer, message, door and resume cases each asserting the frozen harness, model and plan setting after a later pick, b's retry after the harness default changed between attempts, which keeps the frozen model, and d's failed catalog, unlisted param and plan/harness mismatch (`plan: true` on `claude-code` fails the claim by name; `claude-code-plan` with `plan: false` runs in plan mode) |
| ER-3 | Each app sets its default coder in one place, the kit's `defaultHarness`. Prompts and clients read it and keep no copy | FIX-2877 | FIX-2879's spec review; closure sweep |
| ER-4 | `harness` names the harness a coding run uses, by `id`, on a worker or in a task's run settings. No other setting is called `harness` | FIX-2877 | Each child's spec review |
| ER-5 | The person's pick travels as structured turn state, never as message text: the harness kit's `codeWith`, a field of workforce's `sessionFields` keyed slot in its `written: "turn"` mode, sent as the respond action's optional `fields`. Each turn writes its pick, and the pick stays on the session for turns no user started. The harness kit's filler writes it into the task's run settings at filing, by [ER-10](#who-owns-what)'s order. **`codeWith` is not carried at hand-over**, so a task session's carried copy is never read for run settings, anywhere: a linked session reads the root conversation's current `codeWith`, and the run settings a coding run hands down (ER-10 step 2) are a frozen pick, not a copy of `codeWith` ([FIX-2879 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/ef35b2d00b32489103f51ded99b2e4c2e9077662/specs/issues/FIX-2879/DECISIONS.md#d3)). The one instruction about it comes from the harness kit's capability, not from each `WORKER.md`. FIX-2879 removes Teammates' `Coding harness:` line. The Claude Code-style lab's `Coder:` line is FIX-2598's ([FIX-2616 ER-2](../FIX-2616/DECISIONS.md#who-owns-what)), removed in the same PR as the lab's per-harness workers ([D3](#d3)) | FIX-2879 | Closure legs a and b |
| ER-6 | The scripted harness reports the model it was handed, so the closure runs without a signed-in vendor | FIX-2878 | Closure, every leg |
| ER-7 | Consumed issues keep their parents: FIX-2598 under FIX-2616, FIX-2627 under FIX-2618. FIX-2583, FIX-1990 and FIX-2874 are `relates-to` only | The coordinator | Each refresh |
| ER-8 | A resumed harness session belongs to the harness now dispatched. **The door takes no new pick**: the coder flow's `respond`, which is `harnessSessionDoor`, takes no `fields`, so a door talk always runs on the task's frozen coder ([ER-2](#who-owns-what)). A follow-up naming another coder is a new task, filed from the conversation's turn, and that task starts a fresh session on its own harness; one vendor's session is never resumed in another. Under the first-claim freeze ([ER-2](#who-owns-what)) the only path to a different coder is a new task, so a resume path meets a session recorded under other settings only on a row written before the freeze; FIX-2878's spec never resumes one ([FIX-2878 D2](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md#d2)). **The match is by the harness `id` and the plan setting frozen on the run record, both of them** ([ER-4](#who-owns-what)'s name and [ER-2](#who-owns-what)'s triple), beside the session it names, **never by the harness id alone and never by the handle's `source`**: a plan session on `claude-code` is never resumed as an edit session on `claude-code`, and two harnesses can report one source (`claude-code` and `claude-code-plan` both report `claude-code/sdk`; every scripted harness reports `harness-manager/stub`). **Every resume path checks it**: the manager's next attempt and the door's talk. Today `manager.ts` records `source` and checks nothing, leaving the check to "the issue that introduces per-task harness choice"; `session-door.ts` resumes the recorded session unchecked | FIX-2878 | FIX-2879's spec review; closure leg b, under its `source` control and its harness-id-only control: a plan session is not resumed as an edit session on the same `claude-code` |
| ER-9 | A task's input is what its flow's `work` entry declares. `createTask` and `updateTask` check it at filing, the entry checks it again at claim, and `listDelegates` shows it. A flow that declares none takes an open record. No reader parses task input on its own. **The declaration can mark fields server-owned** and supplies the function that fills them: the task-input counterpart of `serverOwned` on session state, one concept. On every filing the board drops what the filer sent for each server-owned field and calls the flow's filler, before the parse; `updateTask` drops them and keeps the stored values. The board knows no field name and takes no host option for it: it asks the assignee's flow. **The project requirement is part of the same declaration**, checked in the same filing check, in the order `assertProjectFor` uses today; `needsProject` goes from the hire's `WorkerFlowEntry` and from the board's options, with no alias (BP-034). It is build-time config, so no stored task changes, and the claim parses only the schema. **For a coding task, `mode` is filer-written and checked at filing** (FIX-2878's part of the declaration): a task that names none gets the app's `defaultMode` written in by the server at filing, before the `requires` check, so a later change to `defaultMode` reaches only tasks not yet filed; the name is validated against the app's registered modes and an unknown one is refused by name; a mode's own required inputs are checked there too: the check reads the mode's `ModeSpec.requires` (FIX-2877's, [#5606](https://github.com/fixpoint-labs/flow-state-dev/pull/5606); Shift Manager's `implement` has `requires: ["issue"]`) and refuses a missing field by name, never running the task in another mode (FIX-2878's, [#5611](https://github.com/fixpoint-labs/flow-state-dev/pull/5611)). The claim re-checks the stored mode's `requires`. A legacy `harnessFeature` marker (`{ issue, phase? }`) is read as `mode: "implement"` with that `issue` (BP-030 dual-read), as a pre-parse step on the declaration, so filing, `updateTask` and claim all see that shape; its `phase` is ignored, whatever it says (the old `phases` map only had `feature`), and nothing writes the marker again; a marker with no valid `issue` is refused, never run as an answer. The filing order is: legacy read, the default mode, the registered set and `requires`, then the assignee worker's mode lock ([ER-11](#who-owns-what)). A task that names `doneWhen` or `workspace` has those keys **dropped** at filing, as a filer's server-owned fields are: they never reach the run, and the open-input contract is unchanged | FIX-2894 | FIX-2878's spec review; closure leg d, with an unknown mode and an `implement` filing with no `issue` each refused by name, and a legacy `harnessFeature` row running as `implement` |
| ER-10 | **A run setting that widens what a run may do is always server-owned.** Today those are `harness` and the plan run setting (`plan`), and any later run setting that changes a run's permissions joins them. **`model` is server-owned too, under the filer-trust rule** (BP-031): it widens cost and capability, not permissions, but a filer's tool args are no more trusted for it. All three are written by the server and always overwrite what the filer sent. Tool args, `input` and `metadata` cannot set them; a filing naming a different harness, or clearing or flipping `plan`, is refused or overwritten, never honoured (BP-031). **A filing's pick is resolved by the server, in this order** ([FIX-2879 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/ef35b2d00b32489103f51ded99b2e4c2e9077662/specs/issues/FIX-2879/DECISIONS.md#d3)): **(1) inside a coding run** (a coding task's session, or any turn that runs inside one): that run's frozen run settings ([ER-2](#who-owns-what)); **(2) below a coding run** (a non-coding task a coding run started, directly or through other non-coding tasks): the run's settings, carried by the server into the task session at hand-over, which win over any `codeWith` and never fall back; **(3) another linked session** (a delegate's, a task's, a workstream lead's, a routine's): the root person conversation's *current* `codeWith`, read at filing by walking the session links; **(4) the person's own conversation:** its `codeWith`; **(5) no pick:** the server-written default, never wider than the person's own no-pick turn; **(6) no root conversation resolves:** the filing is refused by name. Steps 1 and 2 come from the server's run record, never from tool args, and never fall to a default or widen the pick. Only the three run settings are carried; `codeWith` is not carried at hand-over, so no carried copy is read anywhere ([ER-5](#who-owns-what)). **The mechanism is generic** ([ER-9](#who-owns-what)): `codingTaskInput` marks `harness`, `model` and `plan` server-owned, and the harness kit's filler, declared on the coder flow's `work` entry, fills them by that order, with a server-owned marker ([FIX-2878](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md)); `updateTask` keeps the stored values. Workforce drops and fills without knowing any of the names. **The assignee.** On a no-pick filing outside any coding run (step 5: a person's turn or a linked non-coding session), the server writes the assignee, the default's worker, as an **interim** ([FIX-2877 D2](https://github.com/fixpoint-labs/flow-state-dev/blob/bb3f1e8947dca22e2c9477d6077424499c09996a/specs/issues/FIX-2877/DECISIONS.md#d2)), in FIX-2877's write in the harness kit's filing path. **FIX-2878 retires it**: once its filler, on FIX-2894's seam, writes `defaultHarness`, that harness's default model and the plan setting it implies, with its marker, whatever worker the model names, the model's assignee picks the role again and [ER-11](#who-owns-what)'s lock checks it. **Accepted residual:** the model's assignee then also selects that worker's `review` mode; review is process, not permission, so it is not server-owned. **`mode` is not server-owned either**: the filer writes it (Lead legitimately picks answer or implement, as the feature marker does today), bounded by the registered set ([ER-9](#who-owns-what)) and a worker's lock ([ER-11](#who-owns-what)). A mode's `doneWhen` and `workspace` are never task fields: a filer choosing them would widen what a run may do (BP-031), so they stay server code on the kit. Per-task wording is the task's own text, appended to the mode's instructions. A filing inside or below a coding run keeps the model's assignee: the frozen or carried settings win on an unlocked worker, and a locked worker whose lock differs refuses by name, never widening and never swapping ([FIX-2878 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md#d3)) | FIX-2878 | FIX-2879's spec review; closure leg d: tool args name `claude-code` while the turn's pick is plan mode, or absent, and the run is in plan mode; a filer who clears or flips `plan`, on filing or on `updateTask`, still runs in plan mode. Closure leg b: a task filed from a worker's run carries that run's frozen pick, and one filed from a delegate's session after a later pick carries the root conversation's current pick; leg d: a filing whose root conversation does not resolve is refused by name |
| ER-11 | A worker can declare a lock: **its fixed values for any server-owned run setting it declares** ([ER-10](#who-owns-what)), today its harness and its plan setting, not only its harness id. **The lock is checked at claim against the frozen triple** ([ER-2](#who-owns-what)): a pick or a filing whose triple differs on a locked field, a task's run setting, a turn's pick or a pick a background filing inherited, is refused by name, never silently ignored. A worker locked to plan mode refuses an edit pick even when both use `claude-code`. **The lock may also pin `mode`** (`lock: { mode: "answer" }`), though `mode` is filer-written: a filing whose mode differs is refused by name at filing and at claim. **The check runs at claim, in the coder flow, for every worker that claims a coding task**, whoever filed it and whichever worker it names: an unlocked worker runs the task's server-written triple ([ER-2](#who-owns-what)'s order), and a locked one whose locked fields differ refuses by name. So a task never runs on a coder or plan setting other than its server-written one, whoever claims it, and a model-written assignee can't move it to a more permissive worker; this is what lets FIX-2878 retire FIX-2877's interim assignee write ([ER-10](#who-owns-what)). FIX-2878's spec also refuses at filing, so the filer hears it while the person is still in the conversation ([FIX-2878 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md#d3)). The door takes no pick ([ER-8](#who-owns-what)), so there is nothing for the lock to refuse there | FIX-2878 | FIX-2879's spec review; closure leg d: a worker locked to plan mode refuses an edit pick by name at claim even when both use `claude-code`, and a filing whose model-written assignee names a worker locked to a harness other than the turn's pick is refused at claim; a filing whose `mode` differs from a worker's mode lock is refused by name at filing |
| ER-12 | After a plan-mode run (today the `claude-code-plan` harness id; after FIX-2599, the plan run setting), harness-manager fails the run loudly if **the run's own worktree** is dirty, or the run created or moved a ref or branch. **The postcheck is scoped to the run itself**: a common-dir or ref change another concurrent task made never fails it. A plan run that wrote is a failed run, never a quiet success. Read-only enforcement inside each vendor is FIX-2599's ([recorded for it](#analysis)) | FIX-2878 | Closure leg d: a scripted plan-mode run that writes a file in its worktree, or creates or moves a ref or branch, fails by name; a plan run during which another task creates a branch still passes |

**Public names.** No name the set fixes is one [`glossary.mjs`](../../../docs/contributing/glossary.mjs)
retires. FIX-2894's PR adds a *Task input* entry if it is public; its server-owned fields take
the name session state already has (`serverOwned`), not a second term. The glossary has no entry
for either today. FIX-2878's PR adds the *Run settings* entry (the `harness`, `model` and `plan` fields of a coding task's input), names the lock, and amends *Harness* ("a worker's `harness:`
line names one by `id`") to say a task's run settings name one too. FIX-2879's PR amends the
`sessionFields` entry for the `written: "turn"` mode and `codeWith`, if they are public.
FIX-2877's PR adds a *Mode* entry (a named kind of coding run an app registers on the harness kit:
instructions, `doneWhen`, workspace) and retires the `PhaseSpec`, `PhaseDoneVerdict` and `codingPhase` names; it retires no use of the
word "phase", which stays free for a future task-board stage.

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| `harness-manager/src/kit/coder-flow.ts` | FIX-2877 (Shift Manager's options), FIX-2878 (the order), FIX-2583 outside (PR policy options) | The second to merge rebases. FIX-2878 never edits `coder.mts`; Shift Manager gets run settings by moving, not by a copy. FIX-2877 merges before FIX-2878: `coder.mts` imports `harnessFeatureOf`, and FIX-2877's `implement` mode is selected by `harnessFeature`, which FIX-2878 replaces with `mode` and `issue`. FIX-2877 lands the kit's `modes` option and the `ModeSpec` rename; FIX-2878 adds the task's `mode` field, its filing check and its freeze. **FIX-2583:** review and PR policy is moving into the coder flow's options, so the `review` mode FIX-2878 freezes at the first claim reads whatever that option becomes; FIX-2583 keeps the freeze |
| Lead's `WORKER.md`, `labs/teammates/src/lib/harness.ts`, `Composer.tsx` | FIX-2877 and FIX-2879 | FIX-2877 first (a Linear block); FIX-2879 deletes what FIX-2877 left pointing at the one default |
| The filing tool (`createTask`, `updateTask`) and `workerTaskEntry` | FIX-2894, FIX-2878 and FIX-2879 | FIX-2894 lands the declared input, server-owned fields and both checks first. FIX-2878 declares `codingTaskInput`, marks harness, model and plan server-owned and supplies the filler ([ER-10](#who-owns-what)). FIX-2879 adds the turn's `codeWith`, and the root conversation's for a linked session, to that filler and adds no second field |
| Server-owned task-input fields and their filler | FIX-2894 (the mechanism), FIX-2877 (the interim assignee write), FIX-2878 (the harness kit's filler), FIX-2879 (the `codeWith` it reads) | Declared on the assignee flow's `work` entry, beside its input schema and its project requirement, never as a host option on `createTask`: the board asks the assignee's flow, drops what the filer sent for each server-owned field, and calls the flow's filler before the parse, knowing no field name. The harness kit's filler resolves by [ER-10](#who-owns-what)'s six steps, from `run-record.ts` or `codeWith`. **The assignee's seat:** on a no-pick filing outside a coding run, FIX-2877's interim write in the harness kit's filing path sets the assignee to the default's worker; FIX-2878's filler, on this seam, retires it by writing `defaultHarness`, its default model and the plan setting it implies, with the marker, after which the model's assignee picks the role and ER-11's lock checks it. `needsProject` and `assertProjectFor` fold into that one filing check, and `needsProject` goes with no alias (BP-034). FIX-2894's spec names the declaration |
| `harness-manager/src/run-record.ts` | FIX-2877 (the topic segment `phase` becomes `mode`), FIX-2878 (the frozen run settings, `review` and `mode`, and the filler that reads them) | FIX-2878 adds five fields, the three run settings (harness id, model, plan), the worker's `review` mode and the task's `mode`, nullable with default null (BP-030), and writes them only at a task's first claim; no retry, steer, message, door or `updateTask` writes them. Only the three run settings are carried or inherited into a child filing; `review` and `mode` never are |
| The harness kit's capability in `workforce.slots.uses` | FIX-2877 and FIX-2879 | One capability; FIX-2879's instruction sits beside `READINESS_GUIDANCE` |
| The carrier's readers outside the set | FIX-2879's package half, FIX-2598 and FIX-2599 | The package half lands first; FIX-2598 and FIX-2599 read the same run settings and add no second store ([D3](#d3)) |

## Decided, not asked

- **FIX-2877 blocks FIX-2879** (written 2026-11-22). They share three files, and FIX-2879's last
  fallback is FIX-2877's one default.
- **The conversation's pick is the last pick a user's turn carried**, written by the server into
  the session by the turn's own action: `codeWith`, sent as the respond action's optional `fields`
  and parsed against the kit's declaration ([Q-C](#decided-in-review)). No user-writable session
  field is added, in line with FIX-2618 ER-4. A conversation turn no user started reads it. Every
  other filing's pick is resolved by [ER-10](#who-owns-what)'s six steps: a run's frozen or carried
  settings inside or below a coding run, the root conversation's current `codeWith` from another
  linked session, the server-written default with no pick, a refusal with no root. `codeWith` is
  not carried at hand-over, so the task session's carried copy (`carriedSessionFields`) is never read.
- **No teammate default layer.** FIX-2877 removes the unread agent-flow `harness` setting, so the
  layer FIX-2879's issue offered as an option does not exist.
- **Shift Manager's split of feature work from answers** becomes two modes on the kit's `modes`
  option ([ER-1](#who-owns-what)): `implement` (a repo checkout on a branch; done is a commit the
  base lacks; `requires: ["issue"]`) and `answer` (the `answers` scratch host that keeps nothing; done is a
  non-empty answer, not stopped at the limit), with `defaultMode: "answer"`, as a task without the
  feature marker is an answer today. FIX-2877's spec shapes the option. If the flow cannot take it as config, FIX-2877 comments up here:
  that is [FIX-2627 D1](../../issues/FIX-2627/DECISIONS.md#d1)'s *what would change my mind*.
- **Plan mode is a run setting, server-owned from the start**, and FIX-2599 owns the reconciliation
  ([D3](#d3)). This set adds `plan?` to `codingTaskInput` and `codeWith`, server-owned
  ([ER-10](#who-owns-what)) and inert until FIX-2599 (`claude-code-plan` stays the boundary), never a second carrier; FIX-2599 moves plan mode off the
  `claude-code-plan` id onto it. What the alternatives pass found for
  it is [recorded for FIX-2599](#analysis), not built here; this set builds only the postcheck
  ([ER-12](#who-owns-what)).
- **Shift Manager gets no *Code with* picker.** FIX-2877 adds no app behaviour, so a Shift Manager
  task runs on its worker's harness or the kit's `defaultHarness`; closure leg c tests exactly that.

## Decided in review

Answers to what this epic asked, recorded as given on 2026-11-23 so no child reopens them.

- **Q-A · Where run settings live.** Owner's call ([PR comment](https://github.com/fixpoint-labs/flow-state-dev/pull/5571#issuecomment-7088539088), confirmed in session): fields of the coder flow's declared typed task input, and later settings join that schema. The input is `codingTaskInput { harness?, model?, plan?, mode?, issue?, project? }`: `input.project` moves into it, `mode?` and `issue?` replace the `harnessFeature` marker, and the namespacing goes (`plan?` added by the [plan amendment](#decided-in-review); `mode?` and `issue?` by the modes call below, in place of the `feature?` field first recorded here). Carried by [D1](#d1) and the [Adds table](SPEC.md#whats-already-here-and-the-debt). ER-5 stays, sharpened by Q-D.
- **Q-B · FIX-2894, a new prerequisite child.** Owner's call: typed task input, a flow's `work` entry declaring what its tasks take, checked at filing and at claim, shown by `listDelegates`. It blocks FIX-2878 and the closure (both written in Linear). Carried by [ER-9](#who-owns-what) and the set table.
- **Q-C · FIX-2879's carrier.** Owner's call: workforce's `sessionFields` made a keyed slot with a `written: "turn"` mode, not a new session-schema slot. The harness kit fills `codeWith`, the respond action takes optional `fields`, and each turn writes its pick, which stays on the session for turns no user started. Carried by [ER-5](#who-owns-what).
- **Q-D · Security** ([Cursor review](https://github.com/fixpoint-labs/flow-state-dev/pull/5571#pullrequestreview-6015370853), BP-031). The engineering manager's call: harness and model are written by the server from the authenticated turn and always overwrite what the filer sent; a named model runs only from a catalog that answered, with the whole selection listed, or is refused and the harness default runs. FIX-2879's server stamp is no longer cuttable. Carried by [ER-2](#who-owns-what), [ER-10](#who-owns-what) and closure leg d. ER-10 sits with FIX-2878, which declares the fields, so no merge leaves a filer's harness counting before FIX-2879's stamp lands. Amended: `plan` is server-owned too, by the same rule ([below](#decided-in-review)).
- **Q-E · A worker's coder can be locked.** Owner's call: yes. A worker declares its harness fixed, and a request naming another, a task's run setting or a turn's pick, is refused by name, not silently ignored. Carried by [ER-11](#who-owns-what), [D2](#d2) and closure leg d.
- **Owner, 2026-11-23: phases → modes.** An app registers named modes on the harness kit, `modes: { <name>: { instructions, doneWhen, workspace } }`, with a `default` mode it may override in part, and names the one a task without `mode` runs with `defaultMode` (absent: `default`); `PhaseSpec`, `PhaseDoneVerdict` and `codingPhase` become `ModeSpec`, `ModeDoneVerdict` and `codingMode`; a task picks one by name with `codingTaskInput.mode`, which replaces the feature marker (`mode: "implement"` plus `issue`). Why: what a mode changes in the prompt is instructions, which a task may extend with its own text, while `doneWhen` and `workspace` stay server code, because a filer choosing them would widen what a run may do (BP-031); and "phase" is left free for a future task-board idea, plan → implement → review as stages of a task, which would itself be a task on a mode and needs nothing new. `mode` is filer-written, checked at filing against the registered set and the mode's `ModeSpec.requires` ([#5606](https://github.com/fixpoint-labs/flow-state-dev/pull/5606), [#5611](https://github.com/fixpoint-labs/flow-state-dev/pull/5611)), lockable, frozen at first claim and never inherited. Carried by [D1](#d1), [ER-1](#who-owns-what), [ER-2](#who-owns-what), [ER-9](#who-owns-what), [ER-10](#who-owns-what), [ER-11](#who-owns-what) and [sketch.md](sketch.md#7--modes-fix-2877-fix-2878). A material change on its own follow-up PR from `main`, for the owner's renewed approval.

Corrections the engineering manager made on 2026-11-23, from the [alternatives pass](#analysis) and
from writing [sketch.md](sketch.md). They are corrections to defects, not a new design round; each
was checked against ER-1 to ER-11, Q-A to Q-E and [FIX-2616's rules](../FIX-2616/DECISIONS.md#who-owns-what).

- **Freeze per run.** The order runs at the first claim and the pick is frozen on the run record (a triple since the plan amendment); every other route reads it. Carried by [ER-2](#who-owns-what) and [ER-8](#who-owns-what); FIX-2878's. It keeps FIX-2616 D1's "per run" literally.
- **Background filings inherit.** A filing no person started carries the filing run's frozen pick, from the server's run record, never the kit default and never wider. Carried by [ER-10](#who-owns-what); it replaces the "falls to the worker, then the kit" line for those filings and the task session's stale copy. The proposed "narrow to the target worker's lock" is not carried: a lock that differs from the inherited pick is refused by name ([ER-11](#who-owns-what), Q-E).
- **The assignee stamp.** First added as a correction, then dropped on the architect review below, then restored as FIX-2877's interim on the no-pick path outside a coding run, which FIX-2878 retires ([the reconciliation below](#decided-in-review)). Carried by [ER-10](#who-owns-what) and [ER-11](#who-owns-what).
- **Plan runs are post-checked.** Carried by [ER-12](#who-owns-what), FIX-2878's.
- **The door takes no new pick.** A new coder from the conversation is a new task. Carried by [ER-8](#who-owns-what) and [ER-11](#who-owns-what).
- **The model order is the task, then the harness value's default.** No worker or kit model. Carried by [ER-2](#who-owns-what).
- **Shift Manager gets no picker; leg c tests its default.** Carried by [What stays as it is](SPEC.md#what-stays-as-it-is) and closure leg c.
- **The fill seam is named**: server-owned fields on the flow's declared input, filled by the flow's own filler, FIX-2894's mechanism and FIX-2878's harness filler. It replaced a host-supplied stamper on `createTask` on the architect review below. Carried by [Coordination seams](#coordination-seams).

The [architect review of sketch.md](https://github.com/fixpoint-labs/flow-state-dev/pull/5571#issuecomment-7103865868), on 2026-11-23, adopted as the engineering manager's call and checked against ER-1 to ER-12, Q-A to Q-E and [FIX-2616's rules](../FIX-2616/DECISIONS.md#who-owns-what), with no conflict: server-owned fields are generic, the task-input counterpart of `serverOwned` ([ER-9](#who-owns-what)); they and the project requirement are declared on the assignee flow's `work` entry, not as board options, and `needsProject` goes; assignee stamping is dropped, because ER-11's claim check runs for every worker ([ER-10](#who-owns-what), [ER-11](#who-owns-what)).

**Amendment, 2026-11-23: plan is server-owned** ([Cursor security review](https://github.com/fixpoint-labs/flow-state-dev/pull/5603#pullrequestreview-6023766753) on [#5603](https://github.com/fixpoint-labs/flow-state-dev/pull/5603), High, BP-031). FIX-2599 moves plan mode off the `claude-code-plan` harness id onto a run setting. ER-10 server-owned only `harness` and `model`, so a filer's plan field would have stuck: a prompt-injected model could clear or flip it and turn a plan run into a `claude-code` edit run (`acceptEdits`, Bash). ER-11 compares harness ids and ER-12 sees only a dirty tree, refs and the git dir, so neither caught it. Folded, on a follow-up PR from `main` that needs the owner's renewed approval: [ER-10](#who-owns-what) now says a run setting that widens what a run may do is always server-owned, and names `plan` with `harness` and `model`; `codingTaskInput` and `codeWith` gain `plan`, filled only from the authenticated turn or the filing run's frozen pick, with `updateTask` keeping the stored value; [ER-2](#who-owns-what)'s frozen pair is a frozen triple; closure leg d asserts that a filer who clears or flips `plan` still runs in plan mode; and FIX-2599 moves plan mode off the harness id only once this set includes the field ([D3](#d3), [recorded for it](#analysis)). Checked against ER-1 to ER-12 and Q-A to Q-E: it extends Q-D's rule to a third field and conflicts with none. **On the same PR, the rule reaches the lock, resume and the interim.** [ER-11](#who-owns-what)'s lock is a worker's fixed values for any server-owned field it declares, checked at claim against the frozen triple, so a worker locked to plan mode refuses an edit pick on the same `claude-code`. [ER-8](#who-owns-what)'s resume matches the frozen harness id and plan setting, never the id alone, so a plan session is never resumed as an edit one. And until FIX-2599, [ER-2](#who-owns-what) fails a claim whose `plan: true` lands on a harness that is not a plan harness, and `plan` false never loosens a plan harness ([Gitar review](https://github.com/fixpoint-labs/flow-state-dev/pull/5605#discussion_r4667547984), left open for the owner). Closure legs b and d assert each. All three follow from the same BP-031 rule.

**On the same PR, two gaps found on [FIX-2878's spec](https://github.com/fixpoint-labs/flow-state-dev/pull/5604) (Greptile) and fixed at the epic.** [ER-2](#who-owns-what) freezes the effective model, the harness default included, so a retry or an inherited child filing never picks up a later change to `cursorHarness({ model })`; a harness exposes its `defaultModel`, a small `Harness` addition FIX-2878 owns; closure leg b changes the default between attempts and the retry keeps the frozen model. [ER-12](#who-owns-what)'s plan postcheck is scoped to the run's own worktree and the refs and branches it created or moved, so another task's branch never fails a plan run; closure leg d checks it. Scoping was chosen over an isolated read-only repository per plan run: it keeps one checkout model and needs no new store. Reuse, re-run on the moved Adds by the author against `main`: the lock **extends** the worker's `harness:` line to the harness and plan setting; `defaultModel` **extends** `Harness` in `harness-manager/src/harness.ts`, which has no default field today (`cursorHarness({ model })` reaches only its agent); the scoped postcheck **extends** `runChangedFiles`. None is new. The original merge of this spec, [#5571](https://github.com/fixpoint-labs/flow-state-dev/pull/5571), stands as approved; this amendment is reviewed on its own.

**On the same PR, the children's specs reconciled** ([architect](https://github.com/fixpoint-labs/flow-state-dev/pull/5605#issuecomment-7105623353)), so ER-10 is amended once and no follow-up epic PR is needed. The engineering manager's calls, checked against ER-1 to ER-12 and Q-A to Q-E: [ER-10](#who-owns-what) takes [FIX-2879 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/ef35b2d00b32489103f51ded99b2e4c2e9077662/specs/issues/FIX-2879/DECISIONS.md#d3)'s six-step order, and the line "with none, the task carries none and the order falls to the worker, then the kit" goes; [ER-5](#who-owns-what) says `codeWith` is not carried at hand-over and the step-2 settings are a frozen pick, not a copy of it; the no-pick assignee outside a coding run is [FIX-2877 D2](https://github.com/fixpoint-labs/flow-state-dev/blob/bb3f1e8947dca22e2c9477d6077424499c09996a/specs/issues/FIX-2877/DECISIONS.md#d2)'s interim, retired by FIX-2878's filler once it writes `defaultHarness`, its default model and implied plan setting with the marker; the model's assignee then picks the role under [ER-11](#who-owns-what)'s lock, with the accepted residual that it also selects that worker's `review` mode (process, not permission); [ER-2](#who-owns-what) freezes the worker's `review` mode with the three run settings, per task ([FIX-2878 D1](https://github.com/fixpoint-labs/flow-state-dev/blob/3af3a2e0e7b7a455414c0e9e27fff6f59ada52b5/specs/issues/FIX-2878/DECISIONS.md#d1)), and only the run settings are inherited; [ER-8](#who-owns-what)'s only path to a different coder is a new task; `plan?` sits on both carriers, inert until FIX-2599; and FIX-2878 is blocked by FIX-2877 as well as FIX-2894.

## Considered and dropped

| Option | Why it lost |
|---|---|
| Move the `plan` field to FIX-2599, keeping only ER-10's rule here ([second look](https://github.com/fixpoint-labs/flow-state-dev/pull/5605#issuecomment-7104845874)) | [D3](#d3) has FIX-2599 only read the carrier and write no block; moving the field would make FIX-2599 widen the carrier. `plan?` stays on `codingTaskInput` and `codeWith`, inert until FIX-2599, and the disagreement case the look raised is closed by [ER-2](#who-owns-what)'s mismatch refusal |

## What the end-state POC showed

None built. Every hop on the path already exists in some form. Kitchen Sink's harness mode
threads a per-run model into all three harness agents today (`HarnessSessionFeeds.model`), and
`harnessFeature` is a namespaced task-input key harness-manager already reads. A POC would show
the shapes FIX-2878's and FIX-2879's specs own, not whether the division holds.

## Analysis

2026-11-22 · watermark 2026-11-22 (the epic filed). **Independent analysis**: an analyst separate
from the author ran `analysis` and `reuse-review` on the drafted set at `fa4d39a3`, against the
code on `main` `3bdcd2817`. It replaces the authoring pass that ran inline; that pass's findings
stand beneath it.

**Verdict: right approach, with changes.** Each resolution is the engineering manager's call,
checked against ER-1 to ER-7 and [FIX-2616's rules](../FIX-2616/DECISIONS.md#who-owns-what).
None conflicts; 3 and 4 line this set up with FIX-2616 ER-2.

1. **Steer, message and door route by the worker.** `harnessOf` and `byHarness` in
   `harness-manager/src/kit/coder-flow.ts` resolve from the session's worker on every route.
   Folded: [ER-2](#who-owns-what) covers every route, FIX-2878's.
2. **Resuming in another vendor.** The check that a resumed session belongs to the harness now
   dispatched is named in `manager.ts` and owned by no one. Folded: [ER-8](#who-owns-what),
   FIX-2878's; closure leg b tests a changed coder.
3. **The lab between merges.** FIX-2879 removing the lab's `Coder:` line while FIX-2598 owns the
   lab's eight per-harness workers would leave the line gone and the workers standing. Folded: the
   removal moves to FIX-2598 ([D3](#d3), [ER-5](#who-owns-what), *Not done if*).
4. **Plan mode, two shapes.** The lab carries it as a harness id (`claude-code-plan`); this set
   records it as a run setting. Folded: FIX-2599 owns the reconciliation onto the same carrier ([D3](#d3)).
5. **D3 is wider than it needs.** FIX-2598 needs only FIX-2879's package half. Folded: D3
   narrowed, FIX-2599 named as a reader, FIX-2879's split recorded as planned for the spec-set author.
6. **Prior art.** The OpenAI Agents SDK's `RunConfig.model` sets the model for a whole run, over
   each agent's own. It agrees with ER-2. Recorded only.
7. **One plan shape.** The boolean `plan` on `codingTaskInput` and the run record is what FIX-2599's recorded `mode: plan|edit` becomes: one shape, not a second one. Recorded for FIX-2599 (plan amendment, 2026-11-23).

**Reuse on the new Adds (2026-11-23), inline.** The fold added three Adds items; each checked
against `main` by the author, since no sub-agent could be dispatched: the declared input
**extends** `workerTaskEntry` and `listDelegates`; `codingTaskInput` **extends** `harnessFeature`
and `input.project`; the lock **extends** the worker's `harness:` line. None is new.

**Alternatives pass (`adhd`), 2026-11-23**, on head `04ecd124`, run for the other-shapes objective.
A cross-model-family judge was not available, so one model family generated and judged. Its
survivors, as the engineering manager resolved them:

- **Folded:** freeze per run ([ER-2](#who-owns-what)); background filings inherit the filing run's
  frozen pick ([ER-10](#who-owns-what)); the assignee stamped or validated with them
  (dropped, then restored as FIX-2877's interim, [Decided in review](#decided-in-review)); the plan-run postcheck ([ER-12](#who-owns-what)). All FIX-2878's.
- **Recorded for FIX-2599, not built here:** FIX-2599 moves plan mode off the harness id only once
  this set includes the server-owned `plan` field ([ER-10](#who-owns-what)); until then
  `claude-code-plan` stays a harness id, and that id is the permission boundary. Plan as
  `mode: plan|edit`, where the most restrictive pick wins. Per-vendor read-only sandboxes: Codex `sandboxMode: read-only`, Cursor
  `sandboxOptions`, Claude Code `permissionMode: plan`. Stripping push and PR credentials and
  network egress from plan runs. A `settle-claim` POC to see which vendors actually block writes.
- **Considered and dropped:** *the coder as the claimant's identity*, a worker per harness. It
  splits one pick across two carriers, because the model stays a field; it adds a parametric
  roster; and it revives the FIX-2390 per-harness workers FIX-2598 deletes. It contradicts
  [D1](#d1) and [D2](#d2). *Workspace-only plan enforcement*, as a replacement for the above:
  there is no single enforcement point, and it does not cover the network.

**Reuse on the corrections' Adds (2026-11-23), inline**, checked against `main` by the author,
with no sub-agent to dispatch: the frozen pair **extends** `run-record.ts`'s row, whose fields are
already nullable with default null; the postcheck **extends** `runChangedFiles` in `coder-flow.ts`,
which already reads a dirty tree and the tree against the base; the stamper **extends**
`createTask`'s host hooks beside `needsProject`; the assignee check **extends** the board's
workstream rule for a row's assignee. None is new. Both were since replaced on the architect
review: server-owned fields **extend** `serverOwned` on session state onto task input, and the
assignee check is dropped.

**The authoring pass, which the analyst kept.** *Reuse:* every Adds item is **extend**; three
drafted as new are folded into the [Adds table](SPEC.md#whats-already-here-and-the-debt).
*Prior art:* LangGraph's per-invocation `configurable`
([docs](https://langchain-ai.github.io/langgraph/how-tos/configuration/)) and Mastra's
`RuntimeContext` ([docs](https://mastra.ai/docs/agents/runtime-context)) resolve request, then
default, never from message text. *Other shapes:* subtract FIX-2879 (the text carrier stays) and
divide by app (the package change lands twice), both rejected. *New factors:* 35 commits since the
issues' trace (`bb1c097904`); the cited lines hold. *Necessity:* FIX-2879 is the cut candidate,
kept. *Ergonomics:* `harness` sits on task, worker and kit, which one order answers; a model's
shape is the harness's own (Cursor's `{ id, params }`), which FIX-2878's spec makes readable.
*Concerns:* FIX-2877 is not pure cleanup (Shift Manager's split of feature work from answers), and
FIX-2627 kept Shift Manager's flow on purpose; both folded. The lab's carrier built twice became D3.

**Routed:** the three children carry no Kind label (Feature or Improvement); for the coordinator.

## How it got here

- **Drafted (Nov 22)** — three children as filed, and the closure FIX-2883. The children's two
  open questions became D2 and D3 and a *decided* line. FIX-2877 now blocks FIX-2879.
- **Independent analysis (Nov 22)** — ER-2 covers every route; ER-8 added; the lab's `Coder:` line
  moved to FIX-2598; D3 narrowed to FIX-2879's package half, with FIX-2599 owning plan mode.
- **Review round 1 (Nov 22, Codex)** — the closure now drives a delivered message and the door,
  not only a steer, so ER-2's "every route" is checked. ER-8 matches a resumed session by harness
  `id` on both resume paths, never by `source`, and the closure gains a control that a `source`
  check must fail.
- **Owner answers and review round 2 (Nov 23)** — run settings became fields of the coder flow's
  typed task input; FIX-2894 joined as a prerequisite; FIX-2879's carrier is `sessionFields` in a
  `written: "turn"` mode; ER-10 (server-written harness and model), ER-11 (the lock) and the model
  catalog rule in ER-2 came from the security review; closure leg d tests them, and leg a a
  reload. The FIX-2616 ER-2 amendment now merges before any child's implementation.
- **Corrections (Nov 23)** — the alternatives pass ran. Its survivors and the sketch's
  contradictions became the engineering manager's corrections: the pick frozen per run, background
  filings inheriting it, the assignee stamped, plan runs post-checked (ER-12), the door taking no
  pick, the model order without worker or kit layers, leg c on Shift Manager's default, and the
  stamper seam. D2's argument now rests on the next request, not on the task in flight. Not a
  design round.
- **Architect review of the sketch (Nov 23)** — server-owned fields made generic on the flow's
  declared input (ER-9), with the harness kit as their first filler (ER-10); `needsProject` folded
  into the one filing check and removed; the assignee stamp dropped, its threat held by ER-11's
  claim check for every worker. Not a design round.
- **Amendment after merge (Nov 23)** — from the security review on #5603: `plan` joins `harness`
  and `model` as server-owned (ER-10), the frozen pair becomes a triple (ER-2), and closure leg d
  tests a cleared or flipped plan field. A material change, on its own PR, for the owner's renewed
  approval.

- **The children's specs reconciled (Nov 23)** — on the same PR, at the architect's ask: ER-10's
  six-step order and the interim no-pick assignee, ER-5's no-carry, ER-2's freeze of `review`, `plan?` on
  both carriers, and FIX-2878 blocked by FIX-2877. It supersedes the follow-up epic PR FIX-2879's
  spec planned.
- **Amendment after merge: modes (Nov 23)** — the owner's call: the kit's `phases` become `modes`
  (ER-1), the feature marker becomes `codingTaskInput.mode` and `issue` (D1), checked at filing
  (ER-9), filer-written but lockable (ER-10, ER-11), frozen and never inherited (ER-2). On its own
  PR from `main`, for renewed approval.

**Open: none** for the owner beyond approving these amendments.
