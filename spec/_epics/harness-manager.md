# Epic-spec — The harness manager

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** The harness manager exists and works, and it is a prototype: it lives in an
unpublished lab, it knows exactly one coding harness, and nothing outside this repo can build on
it. The first generation of this epic proved the join — a real issue went from a task row to an
open pull request under Conductor, asked a question on the way and was answered — and that proof
is what makes the second generation worth doing. **This epic now finishes the manager as a
production-ready framework piece: one manager, published, driving a second harness (OpenAI Codex)
through the same contract Claude Code drives, with a clean block-oriented way to choose which
harness runs a given piece of work.** The owner's words (`/goal`, 2026-09-01): *"vastly improve
the design of how we have implemented this to be production ready, ensuring that we support at
least one more harness (cursor or codex), and ensure that our harness manager either works across
harnesses or we have one manager per harness … and then make a clean block oriented way to bring
those managers together under one clean system."*

> **Outcome** — A framework user can point the harness manager at Claude Code *or* at Codex,
> per task, and get the same watched, settled, resumable, cancellable run either way — with the
> manager imported from a published package rather than copied out of a lab.
>
> **Proof** — LAB-141's goal check: **one real Linear issue driven from a task row to an open PR
> through each harness** — once under `claudeCodeAgent`, once under the Codex block — including a
> question the run raises mid-flight and gets answered, with the harness chosen per task rather
> than by editing the manager. Readable off the run rows, the inbox rows and the two PRs.
>
> **Lead measure** — the set's goal-proven issues, named each report: LAB-152 · LAB-153 · LAB-154
> · LAB-141 (and LAB-150 behind LAB-154).
>
> **Not doing** — a third harness (Cursor is rejected, theme 11) · a new worker abstraction beyond
> `BlockDefinition` (theme 9) · one manager per harness (theme 9) · a CLI door for Codex (a later
> spawn wrapper, not this epic) · the typed resume field **on the task**, which stays FIX-1179's
> (the manager already carries `previousSessionId`; this epic makes it *reach the harness*, theme
> 12) · the `awaiting_review → parked` rename (FIX-1245) · the operator board's product surface
> (LAB-151 is owner-driven and in the index, not on the Proof's path) · any inbox UI · building
> Relay.
>
> **Kill line** — if a second harness cannot be expressed as *dispatch → handle → resume-by-id →
> abort*, the slot design is wrong and the fork in theme 9 reopens the other way before LAB-154
> builds against it. Reversible: the loop stays in one place either way, and the cost is LAB-153's
> spec round, not shipped surface.

**What the first generation delivered, and what it left.** LAB-138 (the manager loop: a task row
becomes a watched, settled coding run, in its own checkout, settled on a handle-status check),
LAB-139 (a run that needs a decision asks through a durable inbox row, parks, and is answered by
one zero-model action), FIX-150 (workspaces — a run's files as a projection), and three bugs found
by running it — LAB-146, LAB-147, LAB-148 — are all **Done** (§4). It left four things this
generation finishes, each stated at the altitude of a limit rather than buried: **(a)** the
manager is `labs/conductor/src/manager.ts`, private and unpublished, with `claudeCodeAgent` written
into its `.step()` by name; **(b)** the answered run **restarts rather than resumes** — the manager
tracks the last attempt's session id (`previousSessionId`) but the detached path never hands it to
the harness, so the first generation's "continues the same session" leg is still owed (FIX-1179 /
FIX-1246 remain Backlog); **(c)** a module-level `leases` Map keeps a checkout lease alive between
`prepare` and the harness step's synchronous `onSettled`, because FSD state is JSON and the hook
cannot read the request (FIX-1289 is the framework-side answer); **(d)** `PhaseSpec.readable` is
declared, set to `{}` by the only phase, and read by nothing but a name-collision guard. None of
those is a defect in the join; all four are what "prototype" means, and "production ready" is the
owner's instruction to close them.

**Holistic necessity.** Four feature issues and one bug, and the honest question is whether it is
three. **LAB-152** (the contract in a neutral home) could fold into **LAB-154** (the manager gets a
slot and leaves labs/); they are kept apart because **LAB-153** (Codex) needs the contract and does
not need the manager move, so folding them serialises the second harness behind a package
relocation it has no stake in. **LAB-141** (selection + the two-harness Proof) is the issue most
worth cutting on paper — "selection" could be a paragraph in LAB-154 — and it is kept because the
Proof needs both LAB-153 and LAB-154 landed and is the epic's whole outcome; an issue that owns the
proof is what stops two green sub-issues from reading as a finished epic. **LAB-150** is a bug
sequenced behind LAB-154 so the ask marker is moved once, against the manager that will ship, not
twice. **What the set is deliberately not doing** is in the Not-doing line; the largest temptation
is a generic "harness registry" — rejected, because a block slot *is* the registry (theme 9).

**Which project objective this serves.** `docs/objectives.md` **Goal 2, differentiate on hard
problems** — a composable block pattern with a resumable, cancellable run behind a swappable
harness is exactly the kind of capability other frameworks handle poorly — and **Goal 1, validate
through real usage**: the Proof drives a real issue through two real harnesses.

**Gate status.** The owner applied `epic approved` to [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362)
on 2026-08-24 for the first-generation objective. The label does not expire on a push, and the
owner authored the second-generation objective, so the gate is treated as **still passed**;
removing the label is how the owner re-gates this revised objective. The three hard-to-reverse
engineering calls under it — one manager with a slot, Codex as the second harness, the manager's
published home — each land for the owner's ruling at the issue spec gates (LAB-152 / LAB-153 /
LAB-154), which is where a call about mechanism is properly ruled on.

**Context.** The design is the **Conductor Atlas**: <https://claude.ai/code/artifact/f926ff40-e96d-4fd1-87f5-5c7ca05ab3ae>,
which frames Conductor as a *meta-harness* whose harness is swappable. The first generation proved
the join (its open thread 1); this generation makes the swappability true. [LAB-68](https://linear.app/fixpoint-labs/issue/LAB-68/conductor-the-development-orchestration-system-epic)
(Done) is layer zero underneath both. Two source facts every issue here rests on, checked rather
than assumed: **the manager's `decide` step already reads a six-field handle with nothing
Claude-specific in it** — `{ status, sessionId, resultSubtype, finalMessage, usage, costUsd }`
(`labs/conductor/src/manager.ts`, `conductor-decide`'s `inputSchema`) — and **what *is*
Claude-specific sits on the `.step()` call, not in the loop**: `detached: true`, `recordWork:
true`, the `cwd` callback, and `ctx.signal` forwarded into the SDK's abort controller. That split
is why the fork in theme 9 has a recommendation and not just two options.

## 2. Themes & long-horizon direction

*Altitude rule for this document, learned the hard way: **the epic-spec names constraints and
the reference implementation to mirror; the issue specs name the calls.** Three separate reviews
caught the first generation of this document naming a specific API as "the mechanism" and each
time the named API was incomplete, because an epic-spec specifies mechanism without the source
open. A theme that reads like a call sequence has drifted down an altitude; push it into the issue
spec that will write it.*

1. **The coordinator stays small on purpose.** The bet under test is that the session a person
   talks to holds only the *currently-open questions*, because the run's memory lives in
   resources rather than in a conversation. Every design call in this set is judged against
   whether it keeps that true. An issue that finds itself wanting to hold run history in the
   coordinator has hit this theme, not a local design problem — comment up on the epic PR.

2. **One manager; a phase is a record and a harness is a slot — neither edits the manager.** The
   Atlas's argument is that phases differ in a *prompt builder*, a *done-condition predicate* and
   a *readable set*, not in three block sequences. The first generation wrote the manager and
   exactly one record (implement), which cannot falsify that claim, so it bound as a constraint:
   **a manager that cannot be pointed at a different record without editing the manager has broken
   it.** This generation adds the second axis with the same test: **a manager that cannot be
   pointed at a different harness without editing the manager has broken it.** Two harnesses *do*
   falsify the harness half, which is what LAB-141's Proof is for.

3. **Gaps go in the framework, never in conductor** — LAB-68's standing rule, carried forward and
   now acted on at the largest scale this epic has: the generic loop (lease, prepare, run, decide,
   rescue, the question channel, retry) **leaves `labs/`** for a published framework package
   (theme 9), and `labs/conductor` stays as the repo-specific consumer — seed, wake, status,
   Linear, `gh`. The tell that this has gone wrong is unchanged: **a capability only conductor
   can call.**

4. **Sequencing.** **LAB-152 lands first**: LAB-153 and LAB-154 both build against the contract
   it names, and they can be *specced* in parallel but not merged before it. LAB-153 and LAB-154
   are independent of each other and run in parallel. **LAB-141 lands last** — selection needs a
   second harness to select and a manager with a slot to select for. **FIX-1291
   ([#1523](https://github.com/fixpoint-labs/flow-state-dev/pull/1523), open) feeds LAB-154** as
   a blocking dependency: the manager that moves out of labs/ is the one that uses the framework
   instead of hand-plumbing, so LAB-154 does not relocate twenty-one casts. **LAB-150 is behind
   LAB-154** — a *dependency*, not a deferral: the ask marker moves out of the tree once, against
   the manager that ships. **LAB-151 is owner-driven** (PR #1496, In Review) and the epic does not
   dispatch it; it is in the index because it is a sub-issue, and nothing here waits on it.

5. **The ask travels Relay, a human wait is a task *status*, and a normal return always settles the
   task `completed`.** *(Owner decision **D-1** — GitHub issue
   [#1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429), mirrored as FIX-1241.
   **Conductor does not use `ctx.suspend` for ask/HITL.** Delivered by LAB-139; binds every issue
   here because the loop that carries it is the loop being moved.)* Three obligations:

   - **Ask** over **Relay**. The question leaves the run through the relay channel, not by
     suspending the request in place. Conductor **consumes** that channel and does not build it.
   - **Wait** in **`parked`**, not as a suspended request. **`parked` is the status** and
     **dependencies stay `blocked`**; **`needs_input` is the human-ask display/reason**. Shipped
     `awaiting_review` stays until [FIX-1245](https://linear.app/fixpoint-labs/issue/FIX-1245)
     renames it ([#1513](https://github.com/fixpoint-labs/flow-state-dev/pull/1513), draft); this epic
     consumes the rename and does not own it.
   - **Settle** only after checking the run handle's status: a terminal SDK error subtype returns
     normally as `status: "errored"`, so settling on a normal return alone reports a failed run as
     completed. The manager's `decide` step does this today; the moved manager must still.

   **The inbox row still carries the question, and writing it must still be replay-safe.**
   **A caution, not a reason: do not combine `awaitReview` with `ctx.suspend` on today's detached
   runner** — that strands the attempt permanently ([FIX-1200](https://linear.app/fixpoint-labs/issue/FIX-1200)).
   The measured park table that produced D-1 is kept in §5's first entry as evidence, not as a menu.

6. **The operator's answer never travels the public caller-addressed route, and the allow-list is
   never widened.** `packages/engine/src/routes/public-reentry.ts` places `WORKSTREAM_SOURCE` in
   `NEVER_PUBLIC_REENTRY_SOURCES`, no host option overrides it, and
   `test/public-reentry-opt-in.test.ts` covers it: a detached dispatch is not caller-addressed, so
   re-entering it from a public route would run it with caller-supplied input — BP-031. **An issue
   that reaches for the allow-list has hit this theme, not a bug.** The same line governs where a
   resume handle lives on the task — a typed top-level field, never `metadata`
   (`tasks/schema/task.ts:91-97` sets the precedent) — and that field is FIX-1179's.

7. **The runner contract names capabilities, not any harness's notions — and it is now *proven*
   by a second adapter rather than merely constrained.** *(Reversed 2026-09-01: the first
   generation said "proving a second harness is explicitly not in scope". A second harness is now
   the epic's outcome.)* The contract is what a harness block owes the manager: **dispatch a run in
   a working directory → hand back a handle → resume by a session id with a follow-up prompt →
   abort under a caller-enforced deadline**, with the handle carrying status, session id, result
   classification, final text, usage and cost. **What a run touches is harness *configuration*,
   never per-run input — the working directory *and* the session to resume.** A harness block is
   exposed to models as a tool through its capability, so either on the input would let a model
   choose where a run writes, or which conversation it continues into the current checkout
   (BP-031, theme 6's line). Both arrive as trusted state a resolver the host writes reads; the
   block's input is the prompt. Settled by LAB-152's contract (decision 2, after its review) and
   mirrored by LAB-153's, both commenting up (#1362, 2026-09-01 and 02). **The deadline bounds the
   harness, not the commands the harness ran.** LAB-153's POC found a Codex cancel rejects only
   when the CLI's stdout closes, so a subprocess the vendor spawned can outlive the kill — and the
   same is true in kind for the Claude Code adapter, whose abort waits on the SDK's controller. So
   a harness block stops waiting when its own signal fires, not when the vendor's stream closes; a
   runaway command inside the sandbox is the sandbox's to fence; and a manager documents its
   deadline as bounding the harness step and promises no more. **Two consequences the End-state
   POC made visible (§3, 2026-09-02).** The checkout *lease* inherits the same limit: the manager
   releases it when the harness step exits, and after a deadline kill that exit comes while the
   vendor's orphaned command is still writing, so the next attempt can take a checkout that is not
   yet quiet — LAB-154 says what the lease promises after a kill rather than letting the release
   imply a quiet tree. And the contract's home exports the *feed* signatures beside the input and
   handle — the `cwd`/`resume` resolver shape and the session hook, named `onSession` as the slot
   names it — because LAB-153 and LAB-154 each declare them today and land in parallel; whichever
   lands first adds the two types to core, the other imports them. **The tell is unchanged: a clause
   that names a Claude Code notion** — a turn cap, an exit code, `detached`, `recordWork` — has
   broken it, and the fix is to restate that clause as the capability underneath it. **LAB-152 writes the
   contract with the source open; LAB-153 is its falsifier** — a clause Codex cannot satisfy
   without bespoke handling on the manager side is a clause that was Claude-shaped. Portability is
   served by the adapter boundary, not by the seam's transport: the SDK path is still the only
   watched local path for Claude Code, and that is an adapter fact, not a contract clause.

8. **Starting a run and continuing a parked one are the *same* workstream core, not two verbs.**
   Owner constraint on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362):
   *"Do not design `taskStart`/`taskUnpark` as two workstream actions — one `flow.workstream` core,
   reuse-or-mint the harness session id inside it."* **The tell: a caller choosing between two
   entry points.** Two verbs put the reuse-or-mint decision in the caller, which cannot know
   whether a session exists for the task; the core can. `flow.workstream` is today the single
   `ActionCore` a `source: "workstream"` dispatch resolves to
   (`packages/core/src/flow/workstream-core.ts`). **Theme 12's resume input is where this
   constraint meets the harness**: reuse-or-mint happens inside the manager, and the harness
   receives one input either way.

9. **One manager with a harness *slot* — not one manager per harness — published out of labs/.**
   *(Engineering-manager call, 2026-09-01; the owner rules on it at LAB-154's spec gate. The
   alternative is named so the ruling is on a real fork.)* The manager takes its harness as a
   block: `harness: BlockDefinition<HarnessInput, HarnessHandle>`, dropped into the `.step()`
   where `claudeCodeAgent(...)` sits by name today. **Because the checkout path and the session to
   resume are configuration, not input (theme 7), the slot has to hand its harness both some other
   way — and down one channel** — a slot that takes a factory (a harness *per checkout*), or a
   known state the harness's own resolvers read. LAB-154's spec picks (§5); the contract precludes
   neither. A slot that smuggles either onto the input has hit theme 6, not a design problem; and
   two channels — one for the directory, another for the thread id — split the one instruction
   *continue this run in this checkout* into halves that arrive by different routes (LAB-153,
   commenting up). **Why not one manager per
   harness package:** per-package managers duplicate the loop — lease, verdict, question channel, retry — which is
   exactly the reinvention the owner has said they do not want, and the loop already reads nothing
   Claude-specific (§1's handle fact). What *is* Claude-specific (`detached`, `recordWork`, `cwd`,
   forwarding `ctx.signal` into the SDK abort controller) belongs in the adapter, behind the slot.
   **"Bringing them together" (the owner's words) is then either the manager parameterised per
   phase or a router that selects the harness per task** — by assignee or a task field —
   **and LAB-141's spec picks.** Two constraints bind that pick: **no per-harness manager, and no
   new worker abstraction beyond `BlockDefinition`** — the `TaskWorker` alias is deliberately not
   an installation point; workers are board configuration. **The generic loop leaves `labs/` for a
   published framework package; `labs/conductor` stays as the repo-specific consumer.** Which
   package is LAB-154's spec to argue (§5). *(This supersedes the owner's 2026-08-24 call that
   conductor stays unpublished at `labs/conductor/` — superseded by the owner's own "production
   ready", and the part that survives is that the repo-specific layer *does* stay there.)*
   **What would change the recommendation:** a harness whose lifecycle cannot be expressed as
   dispatch → handle → resume-by-id → abort. None of the three candidates is that. **Cost of being
   wrong:** a slot nobody's second harness fits, discovered at LAB-153's goal check — reversible,
   since the loop stays in one place either way.

10. **Dependency direction: no harness package depends on `@flow-state-dev/orchestration`.**
    Today `@flow-state-dev/claude-code` and `@flow-state-dev/orchestration` each depend on `core`
    + `zod` only, and `labs/conductor` depends on claude-code, core, engine and orchestration. A
    harness block is a leaf; the manager composes leaves. So **the contract lives below both** —
    recommended home **`@flow-state-dev/core`** (LAB-152's spec argues it; the constraint, not the
    package, is the theme) — and a harness package that imports the task substrate has inverted
    the layering. **The tell: `@flow-state-dev/codex` or `claude-code` listing `orchestration` in
    `dependencies`.** The manager's package (LAB-154) may depend on orchestration; the harnesses
    it drives may not.

11. **The second harness is OpenAI Codex, via `@openai/codex-sdk`, pinned exactly.** *(Engineering
    call, 2026-09-01; the owner rules at LAB-153's spec gate.)* Doc-evidenced when chosen, and
    **confirmed by LAB-153's POC against 0.152.1's shipped runtime** (`spec-poc/LAB-153-codex-sdk-shape/`,
    2026-09-02 — the thread id arrives on the first streamed event):
    `startThread({ workingDirectory, sandboxMode: "workspace-write", approvalPolicy: "never" })` →
    `run()` returns a typed `{ finalResponse, usage }`; `thread.id` is the resume key;
    `resumeThread(id).run(answer)` is the whole resume story; `signal: AbortSignal` cancels; and it
    spawns `codex exec --experimental-json … resume <id>` underneath, so a CLI door later is a
    spawn wrapper over the same contract, not a new one — mirroring claude-code's `cli/` vs `sdk/`
    split. Headless auth is `CODEX_API_KEY`. **Cursor is rejected**: no npm package (a
    curl-installed binary, nothing to pin), an output-format reference that omits usage and cost,
    self-described "still in beta", and no headless abort or exit-code contract. **Two risks
    recorded here so LAB-153 prices them rather than discovers them:** the JSONL wire sits behind
    `--experimental-json` and can change in a lockstep CLI+SDK bump — **pin exactly (0.152.1
    today) and keep the translate layer thin**; and **Codex exposes no cost field, and the wire
    never names the model that ran** — cost is derived from usage × the framework's one price
    table, present only when the block knows the model, and the contract's cost says whether it was
    reported or estimated (LAB-152 decision 3), so Codex's is honestly an estimate rather than a
    number dressed as one.

12. **Production-ready has a minimum bar, and every item on it is a completion criterion, not
    polish.** **(i)** The manager is published out of labs/ (theme 9). **(ii)** The module-level
    `leases` Map — kept because `onSettled` is synchronous and FSD state is JSON — gets a framework
    home *or* an explicit recorded deferral in LAB-154's spec; FIX-1289 (a request-scoped ephemeral
    side-channel so `onSettled` has somewhere to read from) is the framework-side candidate, and
    silently carrying the Map into a published package is the one outcome not allowed. **(iii)** A
    previous session id **reaches the harness on the detached path**: the manager already carries
    `previousSessionId`, the contract (theme 7) carries resume-by-id, and today the two never meet
    because `detached: true` suppresses the SDK `resume`. This epic closes that gap with one
    decision and one landing: **LAB-152 decides resume's single expression** — trusted state the
    manager resolves and the harness reads through its resolver, never a field on the block's
    input; the input contract is the prompt alone — and **LAB-154 lands the mechanism on both
    sides of the slot**: `previousSessionId` down the same channel that carries the checkout path,
    each harness honouring it on the background path (`claudeCodeAgent` refusing an explicit id
    in-session rather than racing two owners), plus the end-to-end check that an answered run
    continues its session. *(Re-cut 2026-09-02: LAB-152's review took the id off the input, so the
    "harness half" this line first gave LAB-152 no longer exists as separate work.)* The typed
    resume association **on the task** stays FIX-1179's (FIX-1246 the POC under it). **(iv)** `PhaseSpec.readable` is used or removed — a phase's
    readable set is theme 2's own definition of what a phase *is*, so an unused slot there means
    the definition is wrong or the slot is; LAB-154 decides which. **(v)** The goal check drives
    one real issue through **both** harnesses (LAB-141). An epic that wraps with any of the five
    unmet has shipped a prototype with a package name.

## 3. Shape of the whole *(End-state POC, 2026-09-02)*

> **Built:** LAB-152's contract, a Claude block thinned to its seams and a Codex block in the
> shape LAB-153's POC proved, LAB-154's manager with the slot feeding `{ cwd, resume, onSession }`
> and the lease as a value on state, and two managers from one package under two assignees on
> one task board — driven by fake vendors through the real sequencer runtime.
> **See it:** `spec-poc/LAB-140-end-state/` on this branch.
> `pnpm tsx spec-poc/LAB-140-end-state/run.ts` prints the transcript (Claude resumes its
> session; Codex is deadline-killed after the hook saved its thread, and attempt 2 resumes it;
> the board with both assignees); `pnpm tsc -p spec-poc/LAB-140-end-state/tsconfig.json`
> answers the alias question. Its README carries the findings in full.
> **Showed:** the division holds — three issues, no seam two of them both want to own, and
> LAB-141 stays an issue for the Proof (the composition itself is near-zero code: the board's
> assignee registry is already a router). Four seams, one line each:
> - **Lease × orphaned command** — the lease is released on the harness step's exit, and after a
>   deadline kill that exit comes while the vendor's command is still writing (8 writes after
>   release in run B; FIX-1301 makes Claude Code the same). **LAB-154** owns what the lease
>   promises after a kill.
> - **The three feeds are typed nowhere shared** — LAB-153 and LAB-154 each declare the resolver
>   + hook shape, and the hook is `onThread` in one spec and `onSession` in the other. **Was
>   unowned — now theme 7:** the types export from core beside the contract; `onSession` is the
>   name; whichever of LAB-153/LAB-154 lands first adds them.
> - **`source` on the run row** — a detached board fixes a row's assignee at admission, so on the
>   assignee-routed composition a row never changes harness and the "source must match" check
>   has no case; only routing inside one manager by a mutable task field needs it. **LAB-141**
>   decides with its pick; LAB-154 keeps the one nullable column either way.
> - **The alias is `TaskWorker`-shaped** — `BlockDefinition<any, any, HarnessRunInput,
>   HarnessRunHandle>` accepts both extended handles; the schema-typed spelling rejects every real
>   harness. **LAB-152**, implementer note.
> **Changed:** theme 7 gains the lease clause and the feed-types clause, and the LAB-153 /
> LAB-154 / LAB-141 index rows carry them. Held with no change: one `decide` settles both
> harnesses off the neutral handle; an estimated cost reaches the row with its basis; a
> deadline-killed Codex run is resumed by the next attempt because the hook wrote first. Not
> covered: ask/park and the inbox, git provisioning, the real SDKs, `readable` → `uses`,
> multi-tenant identity.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-152](https://linear.app/fixpoint-labs/issue/LAB-152) | The harness contract — input and handle — lives in a neutral home below every harness package (theme 10, recommended `@flow-state-dev/core`), and `claudeCodeAgent` is verified against it with no caller change. Decides resume's one expression — trusted manager-resolved state, never a field on the input (theme 12 iii); the mechanism lands with LAB-154. Blocks LAB-153 and LAB-154 | spec | [#1534](https://github.com/fixpoint-labs/flow-state-dev/pull/1534) | — | In Spec Review |
| [LAB-153](https://linear.app/fixpoint-labs/issue/LAB-153) | `@flow-state-dev/codex` — a Codex harness block that dispatches, continues the thread its host's resolver names, and stops the moment its signal fires, through the contract, reporting usage and an estimated cost (theme 11); its working directory and the thread to continue are configuration, never input (theme 7). SDK shape confirmed by its POC (`spec-poc/LAB-153-codex-sdk-shape/`); declares its `cwd`/`resume` resolvers and `onSession` hook against the feed types in core, adding them if it lands before LAB-154 (theme 7, §3). Blocked by LAB-152. Theme 7's falsifier | spec | [#1535](https://github.com/fixpoint-labs/flow-state-dev/pull/1535) | — | In Spec Review |
| [LAB-154](https://linear.app/fixpoint-labs/issue/LAB-154) | The harness manager is a framework block with a harness slot, published out of labs/ (theme 9); the `leases` Map gets a home or a recorded deferral, resume lands end to end — `previousSessionId` down the slot's trusted channel, each harness reading it through its resolver, and the check that an answered run continues its session (theme 12 iii) — `PhaseSpec.readable` is used or removed (theme 12); the manager reads the contract's neutral `outcome` and `cost` and retires the Claude-shaped duals in the same change (LAB-152's acceptance criterion for it); how the slot hands its harness the checkout path *and* the session id, one channel (§5); its deadline documented as bounding the harness, not what the harness ran, and what the lease promises after a deadline kill, since the step exits while the vendor's orphaned command may still write (theme 7, §3); the slot's feed types shared with LAB-153 through core (theme 7). Blocked by LAB-152 and by FIX-1291 ([#1523](https://github.com/fixpoint-labs/flow-state-dev/pull/1523), open) | spec | — | — | Needs spec |
| [LAB-141](https://linear.app/fixpoint-labs/issue/LAB-141) | Harnesses compose under one system: a harness is chosen per task — the manager parameterised per phase, or a router on a task field; the spec picks, and the board's own assignee registry is the first candidate (§3) — its pick decides whether the run row's `source` check has a case — and **carries the Proof**: one real issue through both harnesses. Blocked by LAB-153 and LAB-154 | spec | — | — | Needs spec |
| [LAB-150](https://linear.app/fixpoint-labs/issue/LAB-150) | The ask marker lives inside the tree the run commits from; move it beside the checkout (or record the residual as accepted). Sequenced behind LAB-154 so it is fixed once, against the new manager | **bug** | — | — | Blocked (LAB-154) |
| [LAB-151](https://linear.app/fixpoint-labs/issue/LAB-151) | `fsdev conductor` operator board on the existing run host. **Owner-driven** — the epic does not dispatch it, and nothing here waits on it | spec | — | [#1496](https://github.com/fixpoint-labs/flow-state-dev/pull/1496) | In Review |
| [LAB-138](https://linear.app/fixpoint-labs/issue/LAB-138/the-harness-manager-a-task-row-becomes-a-watched-settled-coding-run) | *First generation.* The manager loop — a task row becomes a watched, settled coding run, in its own checkout, settled on a handle-status check; the per-run `cwd` seam on the SDK path; the runner contract as first written | spec | [#1437](https://github.com/fixpoint-labs/flow-state-dev/pull/1437) | [#1441](https://github.com/fixpoint-labs/flow-state-dev/pull/1441) | Done |
| [LAB-139](https://linear.app/fixpoint-labs/issue/LAB-139/a-run-that-needs-a-decision-can-ask-for-one-and-be-answered) | *First generation.* A run that needs a decision asks through a durable inbox row, parks (D-1), and is answered by one zero-model action. Carried the first Proof (FIX-1166); its answered run **restarts rather than resumes** — the leg theme 12 (iii) closes at the harness boundary | spec | [#1440](https://github.com/fixpoint-labs/flow-state-dev/pull/1440) | [#1451](https://github.com/fixpoint-labs/flow-state-dev/pull/1451) | Done |
| [LAB-146](https://linear.app/fixpoint-labs/issue/LAB-146) | *First generation.* A failed conductor build no longer leaves the phase pinned to the repository it just checked | **bug** | — | [#1480](https://github.com/fixpoint-labs/flow-state-dev/pull/1480) | Done |
| [LAB-147](https://linear.app/fixpoint-labs/issue/LAB-147) | *First generation.* The ask marker's do-not-commit rule is checked where the marker lands | **bug** | — | [#1483](https://github.com/fixpoint-labs/flow-state-dev/pull/1483) | Done |
| [LAB-148](https://linear.app/fixpoint-labs/issue/LAB-148) | *First generation.* A run that asked is never completed by an earlier attempt's PR | **bug** | — | [#1482](https://github.com/fixpoint-labs/flow-state-dev/pull/1482) | Done |
| [FIX-150](https://linear.app/fixpoint-labs/issue/FIX-150/workspaces-if-validated-workspacerunner-block-and-virtual-filesystem) | *First generation.* Workspaces — the file-projection component (`@flow-state-dev/workspace`), the bash tool on it, the coding-agent path, the per-request workspace scope | spec | [#1345](https://github.com/fixpoint-labs/flow-state-dev/pull/1345) | [#1497](https://github.com/fixpoint-labs/flow-state-dev/pull/1497) · [#1499](https://github.com/fixpoint-labs/flow-state-dev/pull/1499) · [#1501](https://github.com/fixpoint-labs/flow-state-dev/pull/1501) · [#1502](https://github.com/fixpoint-labs/flow-state-dev/pull/1502) · [#1505](https://github.com/fixpoint-labs/flow-state-dev/pull/1505) · [#1506](https://github.com/fixpoint-labs/flow-state-dev/pull/1506) · [#1511](https://github.com/fixpoint-labs/flow-state-dev/pull/1511) | Done |

*A bug carries no spec PR by design — it routes straight to implementation
([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec"). An
empty Spec PR cell on a `bug` row is correct, not a gap.*

**Consumed, not owned — and still not landed.** The first generation's Proof leaned on four
pieces of substrate outside this epic; two are still open and both touch this generation:
[FIX-1179](https://linear.app/fixpoint-labs/issue/FIX-1179) /
[FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) (the typed resume association on the
task, Backlog) — theme 12 (iii) makes resume reach the harness and leaves the task-side field
there; and [FIX-1244](https://linear.app/fixpoint-labs/issue/FIX-1244) (unblock-with-input,
In Spec Review), whose retry discount and second-answer handling LAB-139 documented as its own
limits. [FIX-1234](https://linear.app/fixpoint-labs/issue/FIX-1234) (park-exit) is Done;
[FIX-1230](https://linear.app/fixpoint-labs/issue/FIX-1230) (Relay's announcement) is In
Development and its absence only means the operator reads rather than being told. **The one
framework issue this generation adds to that list is
[FIX-1289](https://linear.app/fixpoint-labs/issue/FIX-1289)** — the `leases` Map's candidate home
(theme 12 ii), consumed if it lands, deferred explicitly if it does not.

## 5. Open cross-cutting questions

**Second generation — three engineering calls made 2026-09-01, each landing for the owner's ruling
at an issue spec gate, and one genuinely open question routed to a spec.** Recorded here as the
durable record; the owner is not asked to rule on them on this PR, because a call about mechanism
is properly ruled on where the mechanism is written.

- **One manager with a harness slot, or one manager per harness package?** *Decided as an
  engineering call: **one manager, `harness: BlockDefinition<HarnessInput, HarnessHandle>` as a
  block slot** (theme 9); the owner rules at **LAB-154's** spec gate.* The alternative — a manager
  inside each harness package, "brought together" by a router — is named because it is the owner's
  own either/or. Rejected because it duplicates the loop the owner has said not to reinvent, and
  because the loop's `decide` step already reads a harness-neutral handle. What would flip it: a
  harness that cannot be expressed as dispatch → handle → resume-by-id → abort.
- **Codex or Cursor as the second harness?** *Decided as an engineering call: **Codex via
  `@openai/codex-sdk`, pinned exactly** (theme 11); the owner rules at **LAB-153's** spec gate.*
  Cursor fails on pinnability, usage/cost reporting and a headless abort contract. Two risks are
  priced in the theme rather than hidden: the experimental JSONL wire, and cost being derived, not
  reported.
- **Where does the generic manager live once it leaves labs/?** *Open — **LAB-154's spec
  argues it**; the owner rules at that gate.* The constraint that binds every candidate is theme
  10: **no harness package may depend on `@flow-state-dev/orchestration`**, so the *contract* sits
  below the harnesses (recommended `@flow-state-dev/core`, LAB-152's spec argues it) and the
  *manager* may sit on orchestration. What is closed: it is not `labs/conductor`, and
  `labs/conductor` stays as the repo-specific consumer.
- **How does a manager with a block slot hand its harness the per-run checkout path and the
  session to resume?** *Open — **LAB-154's spec** picks; raised by LAB-152's spec commenting up
  (#1362, 2026-09-01) and widened by LAB-153's (2026-09-02).* The contract settled that both are
  harness configuration, not input (theme 7, BP-031), which closes the obvious route — a `cwd` or a
  resume id on `HarnessInput`. What is left is a factory-shaped slot or a known state the harness's
  resolvers read; the contract precludes neither, and LAB-153 added the one constraint on the pick:
  **both travel one channel**, or "continue this run in this checkout" arrives in halves by
  different routes. Blocks nothing: LAB-153 builds its block with both as resolvers either way. Not
  an owner ask — no user-visible outcome turns on it, and it is cheap to reverse before LAB-141
  selects.
- **~~Which issue makes resume reach the harness?~~** *Decided on LAB-152's spec commenting up
  (2026-09-01), and re-cut after LAB-152's review (2026-09-02): one decision, one landing.*
  LAB-152 decides the route — resume has exactly one expression, trusted state the manager
  resolves and the harness reads, never a field on the block's input, because a model holding the
  block as a tool could otherwise resume any known session into the current checkout (BP-031).
  LAB-154 lands the mechanism on both sides of the slot and the end-to-end check. The "harness
  half" first given to LAB-152 — an optional resume id on the input, honoured by `claudeCodeAgent`
  — was rejected in LAB-152's review and no longer exists as separate work. Neither owns the typed
  task field (FIX-1179). Theme 12 (iii) and the two §4 rows carry the split so a spec does not
  build the other's half.
- **Where does the `leases` Map go?** *Open — **LAB-154's spec** decides between a framework home
  (FIX-1289, a request-scoped ephemeral side-channel for `onSettled`) and an explicit recorded
  deferral (theme 12 ii).* Not an owner ask: a wrong answer changes nothing a user experiences
  and is cheap to reverse; what is not allowed is carrying the Map into a published package
  without a line saying so.

- **~~Where conductor's own code lives.~~** *Decided by the **product owner on 2026-08-24**
  (#1362): unpublished, `labs/conductor/` — **and superseded on 2026-09-01 by the owner's own
  second-generation objective, "production ready".*** What survives of the 24 Aug call: the
  repo-specific layer (seed, wake, status, Linear, `gh`) **does** stay at `labs/conductor`, beside
  `knowledge-hub` and `trading-desk`. What is superseded: "no published package this epic" — the
  generic loop leaves labs/ (theme 9), and which package is LAB-154's spec to argue (above).
  *(Recorded as the owner's call and the owner's supersession, not as a recommendation that was
  accepted.)*

**First generation — every entry below is closed, kept with its answer so nobody reopens it.**

- **~~Can a detached worker's task be parked in `awaiting_review` and continued by a later
  request?~~** *Resolved: **no**, in every combination on the detached runner as it then was — and
  the conclusion first drawn from that ("therefore suspend") is superseded by D-1.* Settled by
  three POCs on the real path (real `taskBoard()`, durable collection, real SQLite). The evidence,
  kept because it is why D-1 is well-founded and not as a menu:

  | Park via | Measured result |
  |---|---|
  | `awaitReview` + normal return | row stomped to `completed` in the same request — the question is lost |
  | `ctx.suspend` **alone** | parks, but lease renewal stops (120 s default), so the next drain reclaims → duplicate run, and the answered original's write-back is refused `lost-claim` |
  | `awaitReview` **+** `ctx.suspend` | attempt **permanently stranded** while the outer request resolves `error: undefined` — [FIX-1200](https://linear.app/fixpoint-labs/issue/FIX-1200), evidence on draft PR [#1363](https://github.com/fixpoint-labs/flow-state-dev/pull/1363) |

  The lesson that outlived the design: holding a human answer against a *lease* rests on a
  duration chosen before the question is asked, and too short fails silently. A board wait-status
  does not have that property. **For a claim about the task board, read
  `packages/orchestration/test/` before reasoning from source and before commissioning a POC.**
- **~~How long can a question stay open before the board takes the row back?~~** *Moot under
  D-1: the row is not held by a lease because the run does not park the request.* The measurement
  stands (`DEFAULT_LEASE_DURATION_MS`, `lease-recovery.test.ts`, `lease-fence.test.ts`).
- **~~D-1's own open items~~ — ALL CLOSED** *(owner, #1362: "Issue #1429 still-open list is
  empty").* The status is **`parked`**; `needs_input` is the human-ask display/reason;
  dependencies stay `blocked`; shipped `awaiting_review` stays until FIX-1245. The wake is
  FIX-1244 and park-exit FIX-1234, both under FIX-980 — consumed, never owned. "Answered" means
  **continuing the coding agent's own session — restart is not Proof**, and the POC is FIX-1246
  under FIX-1179. FIX-1200's scoped piece is a fence (FIX-1247). In-process Relay is enough; BullMQ
  HITL is out of cycle. `onIdle: complete` must not report success while parked rows are open
  (substrate expectation, not built here). Coordinator UX is this epic's own product call.
- **~~What is the human-wait status called?~~** *Decided: **`parked`** (owner, #1362), superseding
  a same-day answer of `needs_input`.* The shipped verbs `awaitReview` / `resumeFromReview` are
  unchanged.
- **~~Do LAB-138 and LAB-139 merge into one issue?~~** *Decided: no — two, as composed.* Both
  automated reviews pushed to fold them; the product owner ruled against, and both shipped as two.
- **~~Do questions ride the hot path, or wait for the relay layer?~~** *Reversed by **D-1**: the
  questions ride **Relay**.* What the entry established that is still true: a parked run holds
  **no board worker slot** (`execution/runAction.ts:1503-1520`; `countWaitable` skips handed-off
  rows), and lease expiry *invokes* no claim but the next drain reclaims the row.
- **~~Does an answer continue the coding-agent conversation, or restart it?~~** *Answered: **it
  must continue**, and **restart is not Proof**.* Reversed this document's oldest decided entry
  (owner: *"strike it… blocked on that POC for Proof, it does not build the resume itself"*).
  **The shipped same-session resume is FIX-1179's, by a session handle on the task** (owner,
  2026-08-24): `claudeCodeAgent({ detached: true })` is leftover confusion, not a product bet —
  resume was bundled into that flag by mistake, and the throw's own prescribed fix is *"keep the
  worker's state on the task instead"* (`task-board/detached.ts`). **Still true today**, which is
  why theme 12 (iii) exists: LAB-139 shipped a restart and documented it as a limit. This
  generation makes the previous-session input reach the harness; the typed task field remains
  FIX-1179's; `assertDetachedBoardSupported` is not relaxed and `claudeCodeAgent`'s schema-off
  behaviour is not deleted by anything here.
- **~~Is the inbox a new framework capability?~~** *Decided: no — a plain user-scoped resource
  collection.* FIX-1075 asked the right scoping question and the answer was *nothing this epic
  needs*; `labs/conductor/src/inbox.ts` is the pattern, and theme 3 stays intact.

---

**Epic issue:** [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140/the-harness-manager-drive-one-real-issue-through-a-conductor-phase) ·
**Branch:** `epic/harness-manager` ·
**Epic PR:** [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (never merged) ·
**Project:** Development Workflow Orchestration (Labs)

## Epic evolution

- **Epic drafted** — three issues under one outcome: a real issue driven from a task row to an
  open PR without a person in a terminal, with at least one decision asked and answered on the
  way. Kept LAB-138 and LAB-139 as two issues with the seam named, recorded the three settled
  cross-cutting decisions (hot-path questions · steer restarts · the inbox is a plain
  collection), and opened the package-location fork to the product owner.
- **After epic review, round 1** — moved this document's metadata below the objective so the
  problem leads; corrected the FIX-150 story, which had been stated two ways: it is a member of
  the set on its own track, **not** a dependency of the Proof, and the sequencing theme now names
  LAB-138's interim working-directory seam explicitly. Recorded the reviewer's `awaiting_review`
  / wake-seam claim in §5 as an open claim under settlement rather than folding either side of it.
- **After epic review, round 2** — cut §2 from eight themes to four and §5's embedded fork to a
  pointer, because a coordination artifact longer than the specs it coordinates has stopped
  coordinating; the hot-path, steer and inbox decisions were restating §1 and are now §5 entries
  carrying their answers. Reframed theme 2 as a constraint this epic *honours* rather than
  evidence it *produces*, because one record cannot falsify the phase-machine claim. Corrected
  the seam inventory in source — settlement runs through the detached runner's fenced recorders,
  not `settleParentTask`, which `createFlowState` leaves unwired — against a review assertion to
  the contrary. Swapped the Proof issue to FIX-1177 (FIX-1196 is a CLI-wide policy call by its
  own description) and named the forced ask and the operator-present limit, so the Proof is not
  read as more than it is.
- **After epic review, round 3 — the mechanism changed, the objective did not.** Both settlements
  returned and refuted the mechanism §1 described: a detached worker cannot park by holding its
  task in `awaiting_review`, because `recordSuccess` is unconditional and stomps the row to
  `completed` in the same request. Theme 5 replaces it with `ctx.suspend()` plus an in-process
  resume action calling `continueRequest`, and `runs/*` gains `suspensionId`. **One finding, two
  faces:** the same unconditional `recordSuccess` also settles a *failed* run as completed, since
  a terminal SDK error returns `status: "errored"` rather than throwing — so §1 and theme 5 now
  require a handle-status check before settlement, without which the manager's settle/retry/wait
  step can never see a failure. Promoted the never-widen-the-public-route guard to theme 6,
  because the failure mode is a 404 that invites exactly the wrong fix. Relaxed §1's durability
  limit (parking survives a restart) and hardened the one replacing it (a parked row holds a board
  slot; LAB-139 owns the lease-and-reclaim question). Swapped the Proof issue again — FIX-1177 is
  stale, describing a defect that lived on unmerged PR #1297's branch — to FIX-1166, one line in
  CLAUDE.md, verified on `main`. Named LAB-138's per-run `cwd` seam as framework work in theme 4.
  The epic-spec is directionally settled: what remains is carried as implementer notes, not
  further rounds.
- **Correction fold — the third settlement, and a lease setting the owner scoped in.** Not a
  review round; the spec had already converged. Two things forced it. **The last settlement
  returned REFUTED** (evidence on draft PR #1363): `awaitReview` *followed by* `ctx.suspend` does
  not merely cost a re-acquire, it **strands the attempt permanently** while the outer request
  still resolves `error: undefined` — because the runner's pre-worker gate is a `.tap()`, which
  re-executes on the resume of its own suspended dispatch. Theme 5 now carries all three park
  mechanisms as one settled table so nobody re-derives them, plus the general framework fact an
  implementer will meet outside conductor, filed as FIX-1200. And **round 3 overstated
  durability**: the `SuspensionRecord` survives a restart but the task's *ownership* does not,
  because suspending stops lease renewal and the default lease is two minutes — shorter than any
  human answer. The product owner's fix is scoped in as framework work inside LAB-139: a
  board-level claim/lease option on `taskBoard`, which today exposes none, priced honestly in §1
  (a dead worker's row waits out the configured window). *(Superseded by the final entry: the
  window needs no framework change — `TaskBoardConfig.dispatcher` already accepts a `TaskDispatcher`
  instance. The outcome is unchanged; the mechanism is five lines in Conductor.)* **Every correction in this fold was to a
  mechanism. §1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged,
  as they have been through all three rounds. The epic still means exactly what it said.**
- **Correction fold — the wake mechanism was under-specified, and the altitude rule that caused
  it.** Not a review round; the budget is spent and the spec has converged. Theme 5 said the
  operator's answer is delivered by a server-side action calling `continueRequest()`. Checked in
  source (`packages/engine/src/routes/resume-routes.ts:136-227`), that is not sufficient: the
  public route resolves the `SuspensionRecord` and takes a continuation lease *before* it
  continues, and an action skipping those lets two answers start concurrent replays of one
  request while the record stays `pending` forever — both silent, and both exactly the class of
  bug this epic exists to catch. Theme 5 now states the **constraint** (perform the whole
  resolution transaction; mirror that file) instead of naming a call, and LAB-139 carries an
  implementer note to name the calls with the source open. **The reason it is stated as a
  constraint is the pattern**: this is the third review to find this document naming a specific
  API as the mechanism and the third time the named API was incomplete — so §2 now opens with an
  explicit altitude rule, which is the durable fix. **The objective is untouched. §1's five
  lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged; this was a
  completeness correction to a mechanism the epic-spec should not have specified at this
  altitude in the first place.**
- **Constraint fold — the runner contract was not portable, and one clause said so.** Not a review
  round; the budget is spent and the spec has converged. The product owner asked whether a second
  harness should be proven alongside Claude Code. The answer is **no** — that is unchanged and now
  stated in theme 7 in the same breath as the constraint, so nobody reads the constraint as a
  commitment. But the paper check behind the answer (Codex CLI and Cursor's agent CLI, **documented
  not executed**) found the runner seam drawn almost right with one Claude-Code-only clause: a
  turn/time bound. Neither other CLI exposes one, so **theme 7** makes the bound the caller's — a
  killable subprocess and a wall-clock kill — and demotes `maxTurns` to an adapter knob, with the
  result shape, token usage and permission posture named as adapter-normalised rather than shared.
  Its second-order consequence is the part worth having: **the seam is process-spawn, not an
  in-process SDK call**, which is new evidence on one side of LAB-138's `cwd` surface fork (theme
  4) and is **routed there rather than resolved here** — the SDK surface still uniquely carries
  `detached`, `recordWork` and the session handle. **§1's five lines are unchanged.** This epic
  still drives Claude Code only. *(**Superseded 2026-09-01** by the objective fold below: a second
  harness is now in scope, and theme 7 reads the other way.)*
- **Correction fold — two clauses of that constraint were wrong, and a cost we priced does not
  exist.** Not a review round. A Codex review of `92028c5`, verified against the source, overturned
  three things the entry above and its predecessors asserted. **The bound was over-drawn:** "a
  killable subprocess" mandates discarding the only watched coding-agent path we have, and is
  unnecessary — `sdk/agent.ts:434` already forwards `ctx.signal` into the query's
  `abortController`. Theme 7 now requires the runner to be **cancellable under a caller-enforced
  wall-clock deadline**, leaving *how* to each adapter. **The "process-spawn seam" conclusion is
  withdrawn entirely**, because the alternative surface it rested on does not exist: the CLI
  dispatch path shells out to `claude --remote`, a fire-and-forget **cloud task** with no headless
  way to poll or stream progress (`cli/dispatch.ts:1-11`). So the in-process SDK path is the only
  watched local path, theme 4 no longer reads as a surface fork, and **LAB-138 adds `cwd` there** —
  an open fork would have sent its spec to evaluate an option that cannot work. **And the
  held-board-slot cost is deleted, not reduced**: a suspended request settles and lets go
  (`execution/runAction.ts:1503-1520`) and the board never counted the row
  (`task-board/shared.ts:184-198`). The real cost is the task row and its lease, which §5 already
  prices — and the two interlock, since `isHandedOff` goes false exactly when the lease lapses, so
  the row returns to the board's wait count at the moment the human's window closes. FIX-1197's
  relay is re-justified accordingly: not freeing a slot, but removing the dependency on suspension
  and so the long lease. **Both corrections are the same lesson at two altitudes** — a constraint
  that names a mechanism (`subprocess`) smuggles in an implementation, and a cost asserted without
  the source open outlived three rounds of review. **§1's five lines are still unchanged; this fold
  makes the epic cheaper than advertised, not different.**
- **Correction fold — the interlock the last fold was pleased with is inert, and it is the third
  instance of one class.** Not a review round. The entry above closed by claiming the lease and the
  wait count interlock: `isHandedOff` goes false exactly at lease expiry, so the row re-enters the
  board's wait count precisely when the human's window closes. True of the predicate, **inert in
  practice.** `boardQuiescence` returns `"drained"` the moment `inFlightCount === 0` and counts a
  row handed to a Workstream as drained (`task-board/quiescence.ts:95-110`), so in this set's
  one-task flow the launching drain has already exited before the lease lapses; `countWaitable`
  only decides anything while a drain is running. **The consequence is a real limitation, now
  stated in §1 rather than budgeted away:** lease expiry makes a row *claimable* and invokes no
  claim, so a parked run whose harness dies leaves its row `in_progress` indefinitely — until a
  human intervenes or some later drain claims it. *(Superseded by the entry below: a lapsed row
  **is** reclaimed by the next drain, which conductor runs on every wake. The real exposure is a
  duplicate attempt and a fenced write-back, not a permanent strand.)* What would close it (a later drain trigger, the
  settle-time watch, or the cold re-entry path) is named and all of it is out of scope; **no
  recovery machinery is scoped in, and none of it is attributed to FIX-1197**, whose relay is not
  credited with a benefit nobody has checked. The Proof is untouched — one issue, operator present,
  a death is visible — but the design is **not unattended-safe**, and that is now said rather than
  left to be inferred. §5's lease cost, theme 5's *Hold* move and its park table were reconciled to
  the same reading (claimable ≠ reclaimed). **No new theme; §2 stays at seven, and the index is
  unchanged.** **The class, and this is its third instance:** a claim about the board reasoned from
  a *predicate* instead of from the *flow that invokes it* — after the held-slot cost
  (`countWaitable` skips the row) and the re-entry claim (`isHandedOff` flips), both true of the
  predicate and neither reaching the running system. The fix that generalises: for a board claim,
  name the caller that runs the predicate before stating what the predicate buys.
  **§1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged.**
- **Correction fold — theme 7 did to itself what theme 7 exists to prevent, and settlement 4
  corrected our own last correction.** Not a review round. Two corrections, both verified in source,
  both to clauses this document supplied. **First, the resume reference was incomplete.** Theme 5
  cited `resume-routes.ts:136-227` as the transaction to mirror, and that range stops before the
  rollback. The `catch` at `255-273` reverts the `SuspensionRecord` to `pending` and releases the
  continuation lease when setup fails *before the point of no return* — and its own comment
  explains why reverting is safe there and nowhere later, citing FIX-1095 if that boundary moves.
  Mirroring only `136-227` takes the lease, resolves the record, fails during setup, and leaves
  the record resolved with the lease held: **the operator's answer becomes permanently
  non-retryable on a run that never began.** Theme 5's constraint now names revert-and-release as
  part of the transaction and cites the whole handler. *(This entry originally stated that pair in
  the wrong order — resolve before lease. Corrected here; see the consolidation entry below, where
  getting the order wrong a third time is what forced the mechanism out of this document.)* **Second, "exit code" excluded the only
  adapter this epic builds.** Theme 7 defined a machine-readable result as an exit code plus a
  final JSON object; `SdkAgentHandle` (`claude-code/src/sdk/types.ts:32-44`) carries
  `status`/`resultSubtype`/`finalMessage`/`usage`/`costUsd` and **no process and no exit code**, so
  the clause forced the in-process SDK adapter — the only watched path in scope (theme 4) — to
  fabricate a CLI-ism. It is now semantic success/failure plus the terminal payload, with a CLI
  adapter translating its exit code into that.
  **The irony is the lesson.** Theme 7 exists to stop one harness's shape becoming the contract,
  and it was written by taking the *CLI research's* shape and making it the contract — excluding
  the adapter we are actually building. That is the third instance of mechanism-over-capability in
  this one theme (`killable subprocess` → cancellable; the process-spawn seam, withdrawn; exit code
  → semantic result), in three days.
  **So the theme is consolidated rather than corrected a third time.** §2's own altitude rule says
  the epic-spec names constraints and the issue specs name the calls; theme 7's clauses named
  calls, bound exactly one issue (LAB-138 defines the contract; LAB-139 consumes it as a contract),
  and were unverifiable at this altitude — which is what three corrections in three days
  demonstrated. Theme 7 now carries only what is genuinely cross-cutting: the obligation, the
  not-in-scope disclaimer that keeps it from reading as a commitment to a second adapter, the tell
  that makes it falsifiable, and *portability is served by the adapter boundary, not the seam's
  transport*. Its closing paragraph also duplicated theme 4's `cli/dispatch.ts` argument, which is
  how the withdrawn process-spawn conclusion went stale in the first place; theme 4 keeps it.
  **Everything cut is routed, not dropped** — the bound and `sdk/agent.ts:434`, the result shape as
  corrected, adapter-optional usage, per-adapter permission posture, and the
  **documented-not-executed** Codex/Cursor evidence with that caveat attached, all in LAB-138's
  implementer notes. LAB-139's existing resume note was amended in place with the rollback step
  rather than followed by a second note that corrects the first. **§2 stays at seven themes and
  gets shorter; §4's LAB-138 row was reconciled to say where the clauses now live, since a row
  still promising a bound the theme no longer states is the same defect one surface over.**
  **Same fold, second half — settlement 4 came back CONFIRMED, and it corrects the correction
  directly above.** The long lease is load-bearing and the owner's decision stands, settled not by
  a new POC but by **tests already committed and already passing on `main`**:
  `packages/orchestration/test/task-board/lease-recovery.test.ts` (*"a worker that parks on a
  suspension stops holding its task"*) parks a worker on a `SuspensionError`, lets the lease lapse,
  drains a **separately constructed** board over the same live collection, and the row completes
  `attempts 2 · abandonments 1` with a genuinely **new** worker having run the work — corroborated
  by FIX-982's `task-board-detached-child-death` scenario (dispatch 1 → 2) and by the shipped
  comments in `shared.ts`/`quiescence.ts` and `claim-task.ts`. **So the previous entry's conclusion
  is withdrawn**: a parked run whose harness dies is *not* stranded `in_progress` indefinitely.
  Codex's underlying point survives — lease expiry *invokes* no claim — but conductor drains on
  every wake, so reclaim follows in the ordinary course, and a row strands only if no further drain
  ever runs on that board.
  **The replacement limit is sharper than the one it replaces, which is why it is stated rather
  than dropped.** `packages/orchestration/test/collection/lease-fence.test.ts` (*"refuses a settle
  from a worker that ran past its lease"*) shows what happens when the answer finally arrives: the
  resumed original carries its **original claim ticket** across the suspend, the reclaim bumped the
  row's attempt, and the settle is declined `lost-claim`. **The human's answer is delivered into a
  run whose write-back is discarded, and the reclaimed attempt's output is what lands.** A
  too-short lease does not merely cost a duplicate run — it silently forks what the operator
  answered from what shipped. That is now stated beside the lease decision, because it *is* the
  reason the lease value matters. **"Not unattended-safe" is kept, and re-grounded**: not because a
  row strands, but because the only control is a window chosen before the question is asked and
  choosing it too short fails silently. §1's limits, theme 5's *Hold* move and park table, §5's
  lease entry and the hot-path entry were all reconciled to this one reading, and the superseded
  sentence in the entry above is marked in place rather than rewritten, so the log still records
  what we believed when.
  **Process note, and it is the cheap lesson of this fold:** settlement 4 cost nothing to run
  because the answer was already committed. Several of this epic's wrong board claims — the held
  slot, the wait-count interlock, the indefinite strand — would have been answered the same way.
  **For a claim about the task board, read `packages/orchestration/test/` before reasoning from
  source and before commissioning a POC.**
  **§1's five gated lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged;
  what changed in §1 is the limits block beneath the Proof, which now names four limits instead of
  three and no longer overstates one of them.**
- **Consolidation fold — the epic-spec was specifying an implementation it could not verify, and
  it stops.** Not a review round. The two folds above each flagged that §2 was under altitude
  pressure; this one acts on it, and the trigger is a pattern rather than a finding. **Three
  consecutive rounds found a defect in this document's specification of LAB-139's wake path — and
  none of them found a defect in the design.** The mechanism was named at epic altitude, where the
  source is not open, and it was wrong at a reliable rate: a bare `continueRequest()`; then a
  transaction missing its rollback; then, in the same breath as correcting that, **the step order
  itself stated backwards** — `resume-routes.ts` acquires the continuation lease at `201` and only
  then resolves the record at `221`, so the real order is **guards → lease → resolve → continue →
  revert-and-release**, not resolve-then-lease. Under the wrong order two answers can pass the
  pending guard, overwrite the record, and *then* fail lease acquisition, leaving an answer marked
  resolved whose continuation never began.
  **So themes 5 and 7 now carry obligations and no recipes.** Theme 5 keeps the four moves as
  things that must hold — park by suspending alone, hold the claim with a configured lease, wake
  through a single correctly-ordered, replay-safe, idempotent resolution transaction whose
  reference implementation is `resume-routes.ts`, and check the handle before settling — plus the
  measured park table and the durable-replay property that generalises past conductor. Theme 7
  keeps the portability obligation, the not-in-scope disclaimer and the tell. **Everything below
  that altitude moved into LAB-138's and LAB-139's implementer notes and nothing was dropped:** the
  transaction's step order and rollback, the replay-safety requirement, the `suspensionId`
  projection seam, the semantic-result shape, cancellable-with-a-deadline, adapter-optional usage,
  per-adapter permission posture, and the documented-not-executed Codex/Cursor evidence with that
  caveat attached. §5 keeps its decision *records* — what was decided and why is the epic's memory;
  the *how* left with the rest.
  **Two of this fold's three findings are new scope, not prose fixes, and they are LAB-139's.**
  The inbox write that precedes a suspend has no committed output, so it **re-executes on
  continuation** — the same durable-replay property that made the runner's `.tap()` gate unsafe
  (FIX-1200) — and an unguarded write can recreate or reset the row and attach the answer to a
  stale one. And **nothing projects the `suspensionId` anywhere the waker can read**:
  `context/createExecutionContext.ts:3205-3206` mints it internally and immediately throws, and
  `ctx.suspend()` accepts no id and returns nothing, so it reaches the suspension record and the
  stream item but never the run row. Until LAB-139 builds an idempotent projection or lookup seam,
  the wake path cannot address the gate at all. Both are named in theme 5 as obligations and
  specified in LAB-139's notes. *(Superseded by D-1: the `suspensionId` projection seam is withdrawn
  along with the suspend park, and §1's Proof no longer names the pair. The **wake** half of this
  finding did not go away — it moved. **It has since been located: FIX-1244 under FIX-980 owns the
  wake, and this epic consumes it** (owner, #1429). The **replay-safe inbox write** obligation
  survives D-1 unchanged.)*
  **The durable lesson, and it is the one worth keeping past this epic:** an epic-spec that names
  a call sequence has taken on a verification burden it cannot discharge, because verifying a call
  sequence means reading the file, and reading the file is the issue spec's job. §2's altitude rule
  said this after the first instance; it took three to act on it. **§1's five gated lines —
  Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged, as they have been through
  every round and every fold. The epic still means exactly what it said.**
- **Subtraction fold — the answer window needs no framework change, and the epic gives back a
  public-surface expansion.** Not a review round. A P2 from a Codex review, verified in tree.
  This document carried "expose a claim/lease option on `taskBoard`" as framework work inside
  LAB-139 for two folds. **It was never needed.** `TaskBoardConfig.dispatcher` already accepts a
  `TaskDispatcher` instance (`TaskBoardDispatcherInput = TaskDispatcher | "fifo" | "topological" |
  "priority"`, `task-board/shared.ts:27-31`), `TaskDispatcher` is publicly exported from
  `@flow-state-dev/orchestration/tasks` (`tasks/index.ts:137`), and a dispatcher's whole job is to
  call `collection.claim(workerId, opts)` — `fifoDispatcher` is literally that one call
  (`tasks/dispatchers/fifo.ts:10-14`). So Conductor's board configures its own dispatcher with the
  answer window: **five lines in Conductor's own code.** The repo already ships the same shape as
  `leasingDispatcher` in `test/task-board/lease-recovery.test.ts:54-60` — the very test that
  settled the lease question two folds ago.
  **It holds across renewals, which is the half that had to be checked.** `startLeaseRenewal`
  derives its span from the claimed row rather than from a constant —
  `span = claimedTask.leaseUntil - claimedTask.updatedAt`, and every tick writes `now() + span`
  (`tasks/lease-renewal.ts:203-205, 234-238`) — so a dispatcher-set duration is the duration for
  the row's whole life, not a value the first renewal shortens back to the 120 s default. The
  docblock says so outright: *"a dispatcher that claimed with a five-second lease and a driver that
  assumed two minutes cannot disagree, because there is nothing to agree about."* And
  `MAX_LEASE_DURATION_MS` is `2_147_483_647 * 3` (~74 days), sized so `span / 3` fits the renewal
  timer's int32 delay — the constant was built for exactly this.
  **The outcome the product owner signed off on is unchanged.** The answer window is still closed
  and the parked row is still held; the limit §1 prices — a dead worker's row waits out the
  configured window — is the same limit. Only the mechanism got cheaper, so **this is not scope
  being quietly dropped**, and it is said in §5 in those words. What the epic gives back is a
  **public-surface expansion it no longer needs**, which also breaks a symmetry this document
  asserted: the lease is *not* a sibling of LAB-138's per-run `cwd` seam, which is a genuinely
  missing capability (theme 4). One was real framework work and one was a seam we had not looked
  for.
  **Routed, not dropped:** the dispatcher recipe and its four citations are in LAB-138's and
  LAB-139's implementer notes, along with the one caveat that does not belong in this document — a
  bare `collection.claim(workerId, { leaseDurationMs })` takes the substrate's **default**
  eligibility and ordering (pending + deps satisfied), not fifo/topological/priority, which is
  correct for the Proof's one board but means a board that later wants topological ordering
  composes `{ eligibility, order, leaseDurationMs }` rather than dropping the standard dispatcher.
  **The lesson is the mirror of the last fold's.** That one found this document specifying
  mechanism it could not verify; this one found it **scoping framework work that already existed**,
  for the same reason — a claim about a public surface asserted without the surface open. The
  generalisation that covers both: *before scoping framework work, grep the exported type.*
  **§1's five gated lines — Outcome, Proof, Lead measure, Not doing, Kill line — are unchanged.**
- **Owner decision fold — D-1: the HITL path is Relay plus a board wait-status, not `ctx.suspend`.**
  Trigger: the product owner's decision on GitHub issue
  [#1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429) (*"D-1: HITL path — Relay +
  `awaiting_feedback` vs suspend"*), mirrored as FIX-1241. **Not a review round and not a
  correction — a decision that changes the design.** What changed: theme 5 now states three
  obligations (ask over Relay · wait as a task status distinct from blocked-on-dependency · settle
  on the handle check) in place of the four-move suspend park; §1's limits drop the answer window
  and the silent lost-claim and gain the two consequences the decision creates; §5's
  `awaiting_review`, lease and hot-path entries are marked superseded as *plans* and kept as
  *evidence*; D-1's own open items are recorded unanswered; LAB-139's index row and implementer note
  are rescoped. Withdrawn: the `ctx.suspend` park, the configured dispatcher lease window, the
  in-process resume-as-HITL action and its `resume-routes.ts` transaction, and the `suspensionId`
  projection seam. **FIX-1200 survives as a caution** — *do not combine `awaitReview` with
  `ctx.suspend` on today's detached runner* — and no longer as a reason to choose suspend; that
  inference is exactly what D-1 killed. **Unchanged:** the Outcome, the Proof's substance (a real
  issue to an open PR with one decision asked and answered without a terminal), theme 6, theme 7,
  LAB-138, the inbox row as the question's carrier, and the replay-safety obligation on writing it.
  **Two gated lines did change**, which no previous fold has done and which is called out rather
  than buried: the **Proof** line no longer names the `{requestId, suspensionId}` pair it read off
  `runs/*`, and **Not doing** no longer scopes out the relay layer — Relay is the channel now, so
  what this epic is not doing is *building* it. Neither edit touches what the Outcome promises.
  **Why this is not a retreat, in the architect's words on #1429: there is no single primitive, and
  the split is allowed** — an in-request `suspend`, a board wait-status and a Relay send are three
  different things.
- **Owner decision fold — D-1 addendum: the human-wait status is `needs_input`.** *(Superseded by
  the closing fold below: the status is **`parked`**; `needs_input` is the display/reason.)* Trigger: the
  product owner's follow-up on #1429. What changed: theme 5's *Wait* obligation, LAB-139's index row,
  and §5 — the status name moves from the open list to a decided entry. **Dependencies stay
  `blocked`**; a distinct name is the decision rather than a synonym, because a board must be able to
  show which rows wait on a **person** rather than on other work. **`needs_input` is the product
  name; the shipped verbs `awaitReview` and `resumeFromReview` are unchanged.** Recorded as a **new
  open item, deliberately unpicked**: how `needs_input` relates to the shipped status enum — which
  has `awaiting_review` and not `needs_input`, while FIX-1234 (In Review) says the gap is *"the exit
  predicate, not a new status"* — rename · two statuses · product-layer name. **Every other D-1 open item stays open; this settled the name only.**
- **Reversal fold — the enum landing was closed on a recommendation, not on a decision, and is
  reopened.** The sequence, written out because a reader six weeks from now should see that this
  question moved twice rather than find a silent flip — **and because the error in it was an
  attribution error**: at **16:34:14Z** the **Architect recommended** that `needs_input` **rename**
  the shipped enum member; that recommendation **reached this document as though the owner had
  decided it**, and was written in and pushed as **`3a51956`**. At **16:36:15Z the owner held the
  question open** — *"leave the enum-landing question open. D-1 still has a confirm (rename of
  shipped `awaiting_review` vs two statuses). Don't pick it in this spec until that returns."* The
  close was **reverted in `8d1bf43`** and the open state rewritten here. The owner then reaffirmed
  on the PR: *"Decision Manager will not close that on my rec. Jake has not answered it."*
  **To be exact about who decided what: the Architect recommended the rename; the owner has not
  picked between rename and two statuses.** The **name** `needs_input` is the owner's call and is
  decided; the **landing** is not.
  **The lesson, and §5 is precisely where it has to hold: a decision arriving through a channel is
  not the same as a decision made by the person that channel speaks for.** A recommendation is input
  to a decision. Every *Decided* entry in §5 carries weight only because it means **the owner
  decided** — so a relayed recommendation recorded as an owner call does not just mis-credit
  someone, it forges the one signal this section exists to carry.
  **What the reverted close wrongly carried, now removed:** the BP-030 dual-read as **this epic's
  decided path** (it is a consequence of the rename reading only, so asserting it presumed the
  answer — it now appears as that option's price, inside the option), a deprecation/sweep path this
  epic has no business designing, and a follow-up-issue claim for a rename issue that does not
  exist. **The split is now stated before anything else in §5**, because it has been mis-recorded in
  both directions: **`needs_input` as the product name and dependencies staying `blocked` are
  DECIDED**; only the **representation on the row** is open, in three readings — with option 2
  sharpened to the owner's framing, a genuine product distinction rather than an implementation
  variant. **Park-exit #1422 / FIX-1234 is unblocked either way**, the one boundary that survives.
  **Folded in the same pass (Codex P1s on `98eb2d1`):** theme 5 required *persisting* `needs_input`
  while §5 deliberately left the representation open, which made it unimplementable — it now states
  the obligation (a status distinct from `blocked`) and names the representation as the gate on
  **LAB-139's spec at the point it names the field**, not on the issue. And the steer entry stood as
  *decided: it restarts* while D-1 carries *"does 'answered' mean continue the coding-agent
  conversation? (FIX-1179)"* as open — re-opened, narrowed to what holds regardless (nothing today
  can hand a prior SDK session id into a detached run), with §1's Not-doing line narrowed the same
  way and the no-continuity-machinery scope-out unchanged.
  **Kept as neutral fact:** the shipped verbs `awaitReview` / `resumeFromReview` are not renamed by
  anything in D-1. **The lesson about this document's reflexes:** two entries here were re-grounded
  on premises that kept moving, and both times the honest move was to hold the question open rather
  than find the old answer a new justification.
- **Membership fold — D-1 membership closed, and the "unowned wake" claim was false.** Trigger: the
  owner's decision on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) —
  *"D-1 membership closed. Park-exit is not this epic and is not Relay. The human-wait board pair
  lives under FIX-980 (honest task substrate). Unblock-with-input is FIX-1244 … This epic **consumes**
  park-exit + FIX-1244; it does not own them. Still propose no wake locally."*
  **The correction that matters: this document said nobody owned the wake, and that is now wrong.**
  **FIX-1244 owns it** and states the gap in its own words — park-exit lets a drain *leave* while a
  row sits parked, *"that is half the pair"*, and no primitive yet resumes that row with a payload as
  a new workstream request, so *"an honest park-exit is a dead letter."* It also names LAB-139 as
  **first consumer, not owner**, and independently reaches this epic's own finding from the other
  side: `resumeFromReview`/`continueRequest` are the wrong shape after park-exit because they assume
  the launching request is still open. **The wake is a schedule dependency now, not an ownership
  gap** — a distinction §1 and §4 both state rather than blur, because **FIX-1244 is Backlog** and the
  Proof's round trip still needs a verb nobody has built.
  **Second correction, and it was this document's error to inherit: park-exit was priced under
  Relay.** It is not. **One dependency was really two:** the **ask** is Relay's (FIX-1230, In
  Development, under FIX-1197); the **park and the wake** are the honest task substrate's (FIX-980 —
  FIX-1234 In Review, FIX-1238 Backlog, FIX-1244 Backlog), **related to Relay but not parented under
  it, and not under LAB-140.** §1's limits now carry both, named separately.
  **Changed:** §1's dependency and wake limits, §4's index note (still visibility, still not a plan),
  §5 — where membership moves from the open list to a **closed** item rather than being dropped, so
  the record shows it was answered. **Unchanged and deliberately so:** no wake is designed here, no
  scope is added to LAB-139, and no issue is created or implied. **The remaining D-1 opens are
  untouched:** rename vs two statuses · FIX-1200 sequencing · continuity (FIX-1179) ·
  BullMQ/serverless · `onIdle: complete` boards.
- **D-1 closing fold — the decision closed, and two of its answers reversed what this document had
  written.** Trigger: three owner comments on
  [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (18:49 · 18:50 · 19:25);
  **where they conflict the latest wins**, which matters because the status answer moved between
  them. **D-1 is closed — #1429's still-open list is empty.**
  **The status is `parked`, and `needs_input` is demoted to the human-ask display/reason — the *why*,
  not the *what*.** This **supersedes** the answer recorded here earlier the same day, which made
  `needs_input` the status itself; every place calling it "the product name for the status" was
  wrong and is corrected. Dependencies still stay `blocked`. **Shipped `awaiting_review` stays this
  cycle**; the rename is **FIX-1245** under FIX-980, before FIX-980's human-wait closes, and
  **park-exit #1422 is not gated on it.** **The enum-landing question is closed, so the gate it put
  on LAB-139's spec at the field-naming point is gone** — and the status returns to LAB-139's
  buildable list, reversing an edit made an hour earlier when the representation was still undecided.
  **Restart is not Proof — and this kills the oldest decision in this document.** *"LAB-139's
  'continuity out of scope / restart accepted' is **stale** — strike it. This epic is **blocked on
  that POC for Proof**, it does not build the resume itself."* The Proof now **requires** continuing
  the same coding session across the wait; a run that re-states the prompt and starts the agent over
  **does not count as the Proof passing**. The POC is **FIX-1246** under FIX-1179 (Backlog), which
  says the same itself. Struck from §1's Not-doing, §5's decided entry, and the index row. **So the
  consumed set is four, not three** — FIX-1230 · FIX-1234 · FIX-1244 · **FIX-1246** — and every place
  that counted three now counts four.
  **The smaller closures, all recorded as answered rather than dropped:** the FIX-1200 question is
  narrower than asked — the scoped piece is a **fence** (`ctx.suspend` errors inside a workstream),
  **FIX-1247** under FIX-1200, not a rewrite; **in-process Relay is enough for the Proof** and BullMQ
  HITL is out of cycle; **`onIdle: complete` must not report success while parked rows are open** —
  *"the board is not complete while anything is on hold and not cancelled"* — recorded as a
  **substrate expectation this epic relies on**, not as something it builds; and **coordinator UX is
  not a substrate pick at all** (both constructions are already allowed), so it moves out of D-1 and
  into this epic's own product scope.
  **§5 keeps every closed question as struck-and-answered rather than deleting it**, the same
  treatment membership got — a reader has to be able to see what was asked, or the next round
  re-opens it believing nobody considered it. **Boundaries held:** no wake, no resume and no rename
  is designed here; the only scope change to LAB-139 is the status returning to its buildable list.
- **Constraint fold — one `flow.workstream` core, not a `taskStart`/`taskUnpark` pair.** Trigger: an
  owner design constraint on [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) —
  *"Do not design `taskStart`/`taskUnpark` as two workstream actions — one `flow.workstream` core,
  reuse-or-mint the harness session id inside it."* Added as **theme 8**, because it binds both
  issues: LAB-138 enters the core to start a run and LAB-139 re-enters it after a wait, and the
  constraint says those are the same core. **§2 goes from seven themes to eight**; the addition is an
  obligation with a tell, not clause-level detail, which is the line the consolidation fold drew.
  **Checked before writing rather than assumed:** `flow.workstream` **already exists** as the single
  `ActionCore` a `source: "workstream"` dispatch resolves to
  (`packages/core/src/flow/workstream-core.ts` — *"the one workstream core a detached dispatch
  resolves"*). So the theme is worded as constraining a seam that is already there and **not** as
  this epic building one. **No mechanism is stated** — how the session id is reused or minted, and
  where the task's association to it is read, are the issue specs' with the source open, and one line
  in each of LAB-138's and LAB-139's implementer notes points at the constraint. **Nothing else
  moved:** D-1 stays closed, the consumed set stays four, `parked` stays the status.
- **Correction fold — the decided name and the landed enum member are different facts.** Trigger: a
  Codex P2 on `b155d3f`, accepted. §1 listed the human-wait status as buildable on the strength of
  the enum-landing confirm having returned. **True about the decision, false about the code:**
  `TaskStatus` accepts `awaiting_review` and not `parked`, and the rename is FIX-1245 — Backlog and
  external — so an implementer reading "buildable" would reach for a value the schema rejects.
  **The owner's answer is not a re-gate**: *"keep shipped `awaiting_review` in this cycle… park-exit
  ships against whichever name is live."* So **LAB-139 builds against the shipped `awaiting_review`
  now**, `parked` is the decided target, and FIX-1245 renames it later. §1, theme 5 and LAB-139's
  index row all now separate the two facts on the page instead of leaving them to be inferred —
  **this passage has moved three times** (gated · buildable · buildable-against-the-shipped-name),
  and every move came from collapsing a naming decision into a schema state. **The gate that once sat
  on LAB-139's spec is gone and stays gone.**
  **Declined in the same round, and recorded because the reasoning is worth keeping:** a Codex P1
  wanted **FIX-1238** added to the consumed Proof-blocker set, on the grounds that without its
  carrier the manager could misclassify a parked phase. **FIX-1238 does not supply the carrier — it
  hardens one that already works.** In its own words the current path *"works, and it is
  invocation-scoped by construction… But it rests on **ordering discipline, not a typed contract**."*
  The verdict already travels. So **the consumed set stays four** and this document does not imply
  the verdict is missing. **The hazard is real but it is a trap, not a blocker**, and it is aimed at
  the drain LAB-138 composes — routed there as a caution in its implementer note rather than promoted
  to a dependency here.
  **And FIX-1238 is out of §1's enumeration entirely, not merely excluded from the count.** Listing
  it beside FIX-1234 and FIX-1244 — which the Proof genuinely waits on — gave it a status it does not
  have, and left a reader counting **five** links under a sentence that says **four**. That is the
  same class of internal inconsistency this document spent the day removing, so the list and the
  count now agree by construction rather than by a caveat.
- **Correction fold — two claims that outran what is landed, both narrowed rather than gated.**
  Trigger: two Codex findings on `78408a8`, both verified.
  **First (P2): the goal-check claim.** §1 said LAB-139 could *"build and goal-check"* the human-wait
  status and settlement before the consumed work lands. It can build and **unit-test** those; it
  **cannot goal-check the parked phase end to end through the manager loop** until FIX-1234, because
  today's runner is unconditionally `.step(worker).tap(recordSuccess)` and stomps an `awaitReview`
  write to `completed` on any normal return — **row 1 of this document's own measured table.** The
  two claims are now separated on the page. Same class as the `parked` correction directly above: a
  claim about what is **decided** outrunning what is **landed**, which is the failure mode this
  document keeps returning to.
  **Second (P1), and it is the sharpest finding of the day — stated, not solved.** Three legs that
  each look survivable alone: D-1 made same-session continuation **mandatory for the Proof**; the
  only path Conductor has, `claudeCodeAgent({ detached: true })`, **deliberately suppresses the SDK
  `resume`** — *"one decision rather than three… the session provider is not consulted at all"*, with
  the stated consequence *"a second task addressed to the same workstream starts the agent fresh"*
  (`sdk/agent.ts:124-135`); and FIX-1246 is scoped **POC-only**, explicitly excluding the full
  FIX-1179 rewrite. Together: **every named issue and every consumed dependency can finish and the
  Proof still will not run.** Added as a §1 limit beside the wake gap and given the same treatment —
  **named as the owner's, designed nowhere.** The point worth carrying is that a production path
  means **revisiting a documented decision**, not filling an unnoticed hole, and those schedule
  differently. **This document does not re-open that decision**; naming that it would have to be is a
  different act. FIX-1179 is named as the **natural** home and explicitly **not asserted** as the
  answer — the owner decides whether the shipped path is FIX-1179's, LAB-139's, or whether the Proof
  narrows. **§1 goes from four limits to five.** §4's index note gains one clause: its "every issue
  can close while the round trip is unrunnable" point is now true for a **second, independent**
  reason. **Consumed set stays four** — FIX-1179 is not added to it.
  *(**Superseded in part** by the owner's 2026-08-24 call — the last entry below. The resume question
  is closed: FIX-1179 owns the shipped path, the mechanism is the session handle on the task, and the
  limit count went back to four. The goal-check narrowing in the first half of this entry stands.)*
- **Owner decision fold — conductor stays unpublished at `labs/conductor/`.** *(**Superseded
  2026-09-01** by the owner's own "production ready" — the objective fold below; the generic loop
  leaves labs/, the repo-specific consumer stays.)* Trigger: the owner on
  [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (2026-08-24) — *"keep conductor
  unpublished as `labs/conductor/`… Publish vs `labs/` is no longer open."* §5's package-location
  entry moves from an open fork with a coordinator recommendation to **decided, by the owner, dated**
  — the two are different facts, and this document has already once logged a recommendation as an
  owner call, so the entry now says which this is. **LAB-138 names that path** and the gate this entry put on
  its spec is gone; §4's LAB-138 row carries the path and the standing constraint that
  **`@flow-state-dev/conductor` is not introduced this epic**. §5 now has no open entry left, so it
  closes with a pointer rather than an implication. *(The owner said explicitly that this comment did
  **not** close the shipped same-session resume; a second owner call, folded in the same pass and
  logged below, closed that one separately.)* **Nothing else moved:** no scope added, the consumed
  set stays four, `parked` stays the status, and the epic PR's description is the coordinator's
  surface, not this fold's.
- **Owner decision fold — the shipped same-session resume is owned, and `detached: true` was never a
  bet against resume.** Trigger: the owner on
  [#1362](https://github.com/fixpoint-labs/flow-state-dev/pull/1362) (2026-08-24), minutes after the
  package call above and folded in the same pass. *"`claudeCodeAgent({ detached: true })` is leftover
  confusion, not a product bet. The workstream is already the background job… Resume got bundled into
  that flag by mistake. The throw's own prescribed fix is: keep the worker's state on the task."*
  **§1's fifth limit — *"nothing currently owns a shipped same-session resume"* — is retired and
  replaced by a decision**: the shipped path is **FIX-1179's** (FIX-1246 the POC under it), the
  mechanism is the session handle **on the task**, and **restart is still not Proof** (D-1,
  unchanged). Every *"unowned"*, *"natural home but not asserted"* and *"revisiting a documented
  decision"* formulation about resume is gone — they were correct when written and went stale on the
  call. **The limit count moved five → four and the bullets were recounted on the page** (four
  bullets, four in the sentence), which is the enumeration class this document has been bitten by
  repeatedly. **Three inherited constraints added, none of them built here:**
  `assertDetachedBoardSupported` is **not relaxed**; `claudeCodeAgent`'s schema-off behaviour is
  **not deleted** (existing detached boards need it to construct, and renaming or deprecating the
  public `detached` option is **FIX-1179's**, not this epic's design); and **no
  `@flow-state-dev/conductor`**. **One verified constraint routed to FIX-1179, designed nowhere
  here:** the session handle goes in a **typed top-level field, never in `metadata`** —
  `Task.metadata` is `z.record(z.unknown())` and `patchMetadata` spreads arbitrary caller keys,
  exposed to a model through `updateTask`, and the schema's own `abandonments` docblock already sets
  that precedent verbatim (`task.ts:91-97`, BP-031). Resuming into a caller-supplied session id is an
  identity decision from caller-controllable input, which is theme 6's line. **Reconciled in the same
  pass:** §4's index note (its "second, independent reason" is retired; the **schedule** point
  survives), §5's closing pointer, and theme 8 (the association's home is now settled, not
  hypothetical). **Nothing else moved:** **the consumed set is still exactly four** — FIX-1230 ·
  FIX-1234 · FIX-1244 · FIX-1246 — **FIX-1179 is not in it**, no scope was added to LAB-139, and the
  epic PR's description is the coordinator's surface.
- **Clarity fold — "this epic does not build the resume" was ambiguous about its subject, and the
  ambiguity was ours.** Trigger: a Codex **P1** on `6e3da81d` reading FIX-1246 as *"a POC that does
  not build resume"* and proposing that FIX-1179's shipped milestone be wired in as a blocker.
  **The finding's mechanism is wrong and its proposed remedy is declined** — it re-scopes another
  team's issue — **but the misreading is the sentence's fault**: *"This epic consumes it and does not
  build the resume"* puts **the epic** in the subject slot, and it was read as **FIX-1246**. Second
  round on the same claim, so it is fixed rather than argued. **Every instance of that construction
  now names the subject** — *this epic builds no resume machinery; FIX-1246 builds it* — in §1's
  continuity limit, §1's "Not doing", §5's D-1 sub-entry and §5's continuity entry. **Verified in the
  substrate's own text, not taken on report:** FIX-1246 — *"Substrate owns the resume; Conductor
  consumes it"*, desired outcome *"resumed from a second request onto the **same** session…
  same session id / harness thread, not a cold start"*; FIX-1179 — *"Conductor Proof (LAB-139) now
  depends on that POC."* **So the substrate itself names the Proof's dependency as the POC**, which
  is why the consumed set names FIX-1246 and not FIX-1179's shipped milestone. §4's session-resume
  entry now carries both quotes, so "POC" cannot be read as "throwaway" from this page alone.
  **What Codex's worry lands on is real, and the owner raised its weight mid-fold.** *"POC"* and
  *"shippable capability"* are used interchangeably across three documents, and **nobody has
  confirmed FIX-1246 lands as a path LAB-139 can call** rather than a scratch harness — its in-scope
  line is the POC, and it scopes out *"full FIX-1179 rewrite if the POC is narrower."* **If it lands
  throwaway and no shipped path follows, the Proof stalls, and that answer is FIX-1179's.** The owner
  on #1362 (2026-08-24T21:19:45Z): *"The watch item is the residual that matters… **Don't bury that
  as color.**"* So it is **named in §1 at limit altitude**, legible to someone reading only §1, and
  §4's appendix entry points at it rather than carrying it alone — it was drafted as an appendix
  sub-bullet first, which is exactly the burial the owner ruled out.
  **One fact from the same comment, folded so nothing here forbids it:** *"LAB-138 storing an id on
  `runs/*` is bookkeeping, not that path — typed Task field remains 1179."* §1's placement constraint
  now says it constrains the **resume association** only — LAB-138's own `runs/*` bookkeeping is
  legitimate.
  **Nothing else moved:** the consumed set is still exactly four — FIX-1230 · FIX-1234 · FIX-1244 ·
  FIX-1246 — **FIX-1179 is still not in it**, the resume decision, the package call and D-1 are not
  re-opened, no scope was added to LAB-138 or LAB-139, no mechanism was written, and the epic PR's
  description and threads are the coordinator's surface.
- **Objective fold — the second generation: production-ready, a second harness, one manager with
  a slot.** Trigger: the product owner's new objective (`/goal`, 2026-09-01) — *"vastly improve
  the design … to be production ready, ensuring that we support at least one more harness (cursor
  or codex), and ensure that our harness manager either works across harnesses or we have one
  manager per harness … and then make a clean block oriented way to bring those managers together
  under one clean system."* Not a review round (`epic_review: 0`). **§1 is re-drafted, not
  appended**: the first generation (LAB-138 · LAB-139 · LAB-146 · LAB-147 · LAB-148 · FIX-150,
  all Done) is recorded as delivered with the four things it left — the manager private and
  Claude-by-name, the answered run restarting rather than resuming, the module-level `leases` Map,
  the unused `PhaseSpec.readable` — and the new Outcome / Proof / Lead measure / Not doing / Kill
  line sit on top of it. **Two decisions reversed, both named where they stood:** theme 7 no
  longer says a second harness is out of scope — the contract is now *proven* by a second adapter,
  and LAB-153 is its falsifier; and the owner's 24 Aug *"conductor stays unpublished at
  `labs/conductor/`"* is superseded by the owner's own *"production ready"* — the generic loop
  leaves labs/ for a published package, the repo-specific consumer stays. **Four themes added
  (9–12):** one manager with a harness slot rather than one per package, with the alternative
  named and the owner's ruling routed to LAB-154's gate; no harness package depends on
  orchestration, so the contract lives below the harnesses (recommended `@flow-state-dev/core`,
  LAB-152's gate); Codex via `@openai/codex-sdk` pinned exactly, Cursor rejected, two risks priced
  (LAB-153's gate); and the production bar as five completion criteria. **Themes 2 and 4
  re-derived** (a harness is a slot, a phase is a record; the new sequencing LAB-152 → {LAB-153,
  LAB-154} → LAB-141, FIX-1291 feeding LAB-154, LAB-150 behind LAB-154 as a dependency, LAB-151
  owner-driven). **§4 refreshed**: the six delivered rows carry their spec and impl PRs; six new
  rows (LAB-152 · LAB-153 · LAB-154 · LAB-141 · LAB-150 · LAB-151). **§5 condensed**: the
  first-generation entries keep their answers and lose their narratives; the new calls are
  recorded as engineering calls landing at spec gates, and the two genuinely open questions (the
  manager's package, the `leases` Map's home) are routed to LAB-154's spec. **Gate:** `epic
  approved` (24 Aug) stands — the label does not expire on a push and the owner authored the new
  objective; removing it is how the owner re-gates. **Checked in source before writing:**
  `conductor-decide`'s six-field handle and the Claude-specific options on the `.step()` call
  (`labs/conductor/src/manager.ts` on `main`), the `leases` Map, `PhaseSpec.readable` set to `{}`
  by the only phase, and the three packages' `dependencies`.
- **After LAB-152's spec commented up (2026-09-01)** — two cross-cutting settlements folded, not a
  review round. **The working directory is harness *configuration*, never per-run input**, because a
  harness block is model-callable through its capability (BP-031) — so theme 9's slot can no longer
  be read as a bare block handed the checkout on its input: a factory-shaped slot or a resolver-read
  state, LAB-154 picks (§5). And **theme 12 (iii) is now two halves with owners** — LAB-152 the
  harness half, LAB-154 the manager half and the end-to-end check — where it read as one gap nobody
  in §4 was named for. §4: LAB-152's spec PR #1534 is open (In Spec Review); FIX-1245's rename has a
  draft (#1513). **§1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are
  unchanged.**
- **After LAB-153's spec commented up (2026-09-02) — one cross-cutting decision re-cut, one
  contract clause sharpened, not a review round.** **Resume has one expression, and it is not the
  block's input.** The fold above gave LAB-152 a "harness half" — resume-by-id on the input,
  honoured by `claudeCodeAgent` — and LAB-152's own review rejected exactly that (decision 2: a
  block's input schema is model-facing through its capability's tool preset, so a model could
  resume any known session into the current checkout, BP-031). LAB-153 mirrored it (its decision
  2: the directory and the thread to continue come from resolvers the host writes) and added the
  constraint that the slot hands both down **one channel**. So theme 7 now says *what a run
  touches* is configuration — directory and session alike — theme 9's slot hands both down one
  channel, theme 12 (iii) is one decision (LAB-152) and one landing (LAB-154) instead of two halves,
  and §5's open question is widened to match. **The deadline bounds the harness, not what the
  harness ran:** LAB-153's POC found a Codex cancel rejects only when the CLI's stdout closes, so
  theme 7 now requires a harness block to stop waiting when its own signal fires and names the
  sandbox as the fence for a runaway command; LAB-154 documents its deadline accordingly. Also
  folded: theme 11's SDK facts are executed, not doc-evidenced, and its cost line reads the way
  LAB-152's decision 3 shaped it; LAB-154's row carries LAB-152's acceptance criterion (read
  `outcome`/`cost`, retire the duals in the same change). §4: LAB-153's spec PR #1535 is open (In
  Spec Review). **§1's five lines — Outcome, Proof, Lead measure, Not doing, Kill line — are
  unchanged.**
- **End-state POC — the division holds; two seams named, one of them unowned until now.** Not a
  review round (costs none). `spec-poc/LAB-140-end-state/` assembles LAB-152's contract, both
  harness blocks, LAB-154's slot and two managers on one board, and runs it (§3). The set stays
  three feature issues plus the Proof; nothing one issue delivers makes another's redundant, and
  the composition LAB-141 owns is near-zero code because the board's assignee registry is a
  router. Theme 7 gains two clauses the run made visible: the checkout lease inherits the
  deadline's limit (released at step exit while the vendor's orphaned command may still write —
  LAB-154 says what the lease promises after a kill), and the feed signatures the slot hands a
  harness export from core beside the contract, `onSession` the hook's name, because LAB-153 and
  LAB-154 each declare them today and land in parallel. Routed as implementer notes, not folded:
  the conformance alias is `TaskWorker`-shaped (LAB-152); the run row's `source` check has no case
  on an assignee-routed board (LAB-141 decides). **§1's five lines are unchanged.**
