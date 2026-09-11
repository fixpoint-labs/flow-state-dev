# FIX-1359 — Default Workforce agent flow: OOTB replaceable `agent` flow kind

*The vocabulary, the POC spine, the prompt/skills/memory direction, the replaceability contract
and the child cut were locked by the Architect and owner on 2026-09-11 in
[FIX-1359](https://linear.app/fixpoint-labs/issue/FIX-1359)'s description. This document turns
that record into an epic-spec; it does not re-decide it. Where the record does not settle
something, §5 says so and names who decides.*

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Someone building on Workforce today can hire a roster, but they cannot hire a
working agent. Every app that wants one either writes its own agent flow from scratch or leans
on a second agent factory (`defineAgent` / `AgentRegistry` / `materializeAgent`) that we have
already decided to delete. When this epic lands, a `WORKER.md` with nothing but instructions
produces a seat that talks, remembers within the scopes we already ship, and can use the skills
registered to it — and a team that wants something different names their own kind on one line.

**"Nothing but instructions" means zero config lines, and that is now decided, not aspirational.**
An omitted `flow:` selects the built-in agent kind, and the built-in reaches the `kinds` map
without the app naming it (Architect stamp on [PR #1730](https://github.com/fixpoint-labs/flow-state-dev/pull/1730),
2026-09-11, explicitly *not* a Jake D-n). `hireWorkforce` refuses an absent `flow:` today — that
is the work this epic does, not the behaviour it describes. Theme 5 carries the contract.

**Which objective, and how it is proven.** [`docs/objectives.md`](../../docs/objectives.md)
**Goal 1 — Validate through real usage**; the published objective on FIX-1359 is *"Workforce
multi-seat real usage (OOTB agent seat)."*

Six of the seven issues add **surface** — a kind, a skill bind, a memory attach, docs. The
seventh, **FIX-1365 (Thin Proof: hire the OOTB agent kind), is required**, and it is the only
child shaped to produce a goal check. The epic cannot finish without it. That decision (D-4,
Architect + Cycle PM on [PR #1730](https://github.com/fixpoint-labs/flow-state-dev/pull/1730),
2026-09-11) is what makes this set answerable against the project's lead measure — goals passing
over goals defined — instead of a set that can complete in full and move that number by zero.
An OOTB agent seat nobody has hired is a claim, not a capability.

**Holistic necessity.** Seven issues, and the composition question is whether it's really six.

- **The substance is four**: FIX-1361 (the kind's contract), FIX-1363 (the kind itself),
  FIX-1362 (per-seat skills into it), FIX-1364 (memory onto existing scopes). Drop any and the
  OOTB seat is missing something a real app needs on day one.
- **FIX-1360 (kitchen-sink drift audit) is cheap reconnaissance that pays for itself.** Review
  asked for it to become a research section inside FIX-1363's spec. Kept as an issue: the drift
  note is cited by FIX-1361, FIX-1362, FIX-1363 and FIX-1364, and one shared artifact beats four
  specs each re-reading the same app.
- **FIX-1366 (Atlas teach) is not optional** despite being docs. The teach path is what
  currently points people at `defineAgent`; a kind that ships while the Atlas still teaches the
  killed surface leaves two documented ways to build an agent.
- **FIX-1361 was challenged at the gate and kept — seven stands.** Three reviewers made the same
  argument: a standalone "Spec:" issue sits awkwardly next to our own routing, where FIX-1363
  writes and gates its own spec anyway
  ([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a spec").
  The Architect's answer (PR #1730, 2026-09-11) is that the chain needs a contract artifact
  *before* implementation starts, and that collapsing pre-emptively is the wrong direction.
  **The collapse trigger is named and live**: if FIX-1361's deliverable turns out to *be*
  FIX-1363's gated spec — the same document, carrying no decisions of its own — collapse then.
  It is further from that than it was: the admission answer (theme 5) hands FIX-1361 a rule of
  its own to write — absent `flow:` means default, an unregistered name means a loud error.
- **FIX-1362 and FIX-1364 stay two issues, and neither folds into FIX-1363.** Also challenged at
  the gate. They are different scopes with different decisions to make (theme 7's skills merge
  and isolation rule; theme 4's named-gap honesty), not two halves of one change.

**Not doing.** No second Agent L1 type and no growing `AgentRegistry` into a product Agent. No
new memory-isolation primitive — existing scopes only, and a gap gets named rather than faked.
No persona builder (the hire body key is `instructions`). No Collab or channel roster — that
stays on W3 / FIX-1341. No MCP door. This epic is **parallel to** W3 (FIX-1351), not under it.
FIX-1365 being required does not widen it: a thin hire of the OOTB agent kind, nothing more.

## 2. Themes & long-horizon direction

1. **Vocabulary is locked, and thin/fat is dead.** A **seat** is a roster slot resolving to one
   **flow instance**, declared as `WORKER.md`. A **kind** is a flow factory on hire's `kinds`
   map; a seat's `flow:` only *names* a registered kind. A **worker** is a generator or flow
   with whatever that kind needs. The **agent kind** is the opinionated default: instructions
   plus shared default prompt, model, tools, memory, skill register/activate. A sequencer or
   intake seat is not a degraded agent — it is a different kind. No child spec revives "thin" or
   "fat", and no child introduces a fifth term for any of these four.

2. **The agent kind consumes prompt composition; it never invents one.** Generator slots stay
   `prompt` / `context` / `history` / `user`. The hire and `WORKER.md` body key is
   `instructions`. The default worker system prompt is one shared config composed as
   `prompt: [default, instructions]`, and **FIX-1344 owns shipping it** (theme 6).
   **FIX-1363 consumes that composition and defines no second default-prompt config anywhere in
   this epic** — decided by the Architect on PR #1730, 2026-09-11. If FIX-1363 starts before
   FIX-1344 part 2 lands, it ships against `instructions` alone with an **explicit seam** for
   `default` to drop into. FIX-1363 is therefore *unblocked by* W2, not sequenced behind it, and
   an issue here that finds itself defining a second prompt system has hit a cross-cutting
   question and comments up on this PR rather than deciding locally.

3. **No second registry, and no child waits on the first one dying.** `defineAgent`,
   `materializeAgent` and `AgentRegistry` are kill targets owned by FIX-1344 / PR #1713 — all
   three are still live in `packages/workforce/src/`. No issue here extends them, imports them,
   or mirrors their shape. Equally, **no issue here blocks on their deletion**: the new kind is
   built beside them and the invent-kill lands on its own schedule.

4. **Memory attaches to existing scopes, and a gap is named rather than filled.** `session`,
   `user`, `org` and any already-shipped member patterns. Identity and durable member memory
   belong on agent/member scope, never on the seat object. If durable per-member isolation is
   still an L1 gap when FIX-1364 gets there, the deliverable is a named gap on Atlas and a
   ticket — **not** seat-local memory that looks durable and isn't.

5. **Replaceability is one line in `WORKER.md`.** The built-in kind carries an id (`agent` or
   near it — the exact string is an engineering call in FIX-1361). `flow: myCustomAgent` wins
   whenever that kind is on the hire `kinds` map, and custom kinds register exactly as other
   flow factories do. No `worker.ts` as a `WorkerManifest` seat door — that fence is W3's
   (FIX-1342) and this epic does not reopen it.

   **The built-in's own admission is decided: an omitted `flow:` selects it.** `hireWorkforce`
   today refuses a record that declares no `flow:` ("declares no `flow:`, so there is no flow
   kind to hire it into", `packages/workforce/src/hire.ts`) and resolves only factories
   explicitly passed in `options.kinds` — so nothing in the *current* surface makes an
   instructions-only `WORKER.md` hireable. **That gap is this epic's work.** The answer
   (Architect stamp, PR #1730, 2026-09-11): an omitted `flow:` selects the built-in agent kind,
   and the built-in must therefore reach the `kinds` map **without the app naming it**. The
   narrow alternative — `flow: agent` plus explicit registration — was **rejected**, because it
   narrows §1's headline into the same paper cut `defineAgent` already made people pay.
   **FIX-1361 writes the contract, FIX-1363 ships it**, and neither re-opens the choice.

   **The loud-fail rule rides with it, and it is FIX-1361's too.** Implicit selection must not
   turn a *typo'd* kind name into a silent hire of the agent: a seat naming a kind that isn't
   registered fails loudly, exactly as it does today. Absent means default; wrong means error.
   Raised by Codex review on PR #1730, verified against the source, and settled there.

6. **The two soft deps live in other epics, and one of them is only half shipped.** Neither is a
   parent. This is the sequencing fact most likely to be read wrong, so it is stated in parts:

| Dep | Epic | State (verified 2026-09-11) | What this epic needs from it |
|---|---|---|---|
| **FIX-1344** part 1 — `instructions` key | W2 / FIX-1332 | **Merged** (PR #1701). `INSTRUCTIONS_KEY` live at `packages/workforce/src/manifest.ts:38`, handled in `hire.ts` | Nothing further — the body key is settled |
| **FIX-1344** part 2 — configurable default worker system prompt | W2 / FIX-1332 | **Not shipped.** No default-prompt config exists in `packages/workforce/src` | The `default` half of theme 2. **FIX-1363 consumes it and does not define one** — `instructions` alone plus an explicit seam if part 2 has not landed |
| **FIX-1344** part 3 — invent-kill of the `defineAgent` cluster | W2 / FIX-1332 | **Not merged.** PR #1713 (`fix/remove-define-agent-cluster`) is an open draft; all three symbols still live | Nothing — theme 3 says no child waits on it |
| **FIX-1356** — skills file convention | W3 / FIX-1351 | **In Review.** Impl PR #1728 open | The load rules FIX-1362's per-seat register consumes |

**FIX-1344 is not "done".** Its Linear state is `In Development` and only part 1 has landed.
Sequencing FIX-1363 as if the default prompt already exists is the specific mistake this row
exists to prevent — and theme 2 is why that mistake no longer costs anything: the kind is
built against `instructions` with a seam, whenever part 2 arrives.

7. **Skills isolate at per-seat registration, not at the skill name.** The earlier
   "globally unique skill names across teams" direction on FIX-1356 is **withdrawn**. A seat's
   flow registers `org/skills` ∪ `teams/<thatTeam>/skills` ∪ `workers/<thatSeat>/skills`, with
   bare `SKILL.md` names kept. Skills beside the worker are auto-available with no `skills:`
   list. The same bare name on two teams is fine — collections never merge across teams — but
   the same name twice in **one** seat's view still needs refuse-or-precedence, and that exact
   merge rule is FIX-1362's decision to make. FIX-1356 owns the convention and the load rules;
   **the runtime bind of the registered set into the agent kind is FIX-1362's**, here.

   **Registration alone does not isolate storage, and today it doesn't.**
   `createSkillsLibrary` defaults its collection to the key `skills` at **`org` scope**
   (`packages/orchestration/src/skills/library.ts`), so two seats in one org registering the same
   bare `SKILL.md` name resolve to the same collection entry — one team's skill overwrites or
   bleeds into another's. The promise above therefore holds at the *view* level and not yet at
   the *storage* level. **Per-seat isolation has to be a real resource identity** — distinct
   collection key, prefix or scope per team/seat — not a per-seat register over one shared
   collection. FIX-1361 states that isolation contract and FIX-1362 implements it. Raised by
   Codex review on PR #1730 and verified against the source.

8. **Kitchen-sink is characterization, not the product API.** `apps/kitchen-sink` (especially
   `chat-agent` and the skill activator) is the closest working composition of the agent shape
   we have, and it is the baseline to port from. It is also probably behind the current hire /
   `WORKER.md` surface. So: do not redesign skill activation from zero while a working activator
   exists, and do not treat anything in kitchen-sink as a shipping contract. FIX-1360 produces
   the drift note — what KS still proves, what must be re-homed — and every later issue cites it
   instead of re-reading the app.

## 3. Shape of the whole

**No end-state POC was built for this epic, and the gate did not change that.** The trigger this
section named — real disagreement about whether the agent kind and the skill bind are one issue
or two — did fire at review. It was settled in prose instead: FIX-1362 and FIX-1364 carry
decisions of their own (the skills merge and isolation rule; named-gap honesty), which is a
different kind of separation from a surface two issues would both want to own. The end state the
Architect locked is still narrow — one built-in kind, on an existing hire surface, with three
known attachments — so a POC would buy sequencing confidence the mermaid below already gives.

What the division should be judged on instead is that **this epic is a chain, not a fan-out**:

```mermaid
flowchart TD
  A[FIX-1360<br/>KS drift audit] -->|drift note| B[FIX-1361<br/>agent kind contract]
  B -->|contract| C[FIX-1363<br/>impl: agent kind]
  C -->|kind to bind into| D[FIX-1362<br/>per-seat skills]
  C -->|kind to attach to| E[FIX-1364<br/>memory + gap honesty]
  C --> F[FIX-1366<br/>Atlas teach]
  D --> G[FIX-1365<br/>Thin Proof · required]
  E --> G
```

Only **FIX-1360 and FIX-1361 are startable today**, and FIX-1361 largely wants FIX-1360's drift
note first. Everything after FIX-1361 sequences behind it; the only genuine parallelism in the
set is FIX-1362 and FIX-1364 once the kind exists. FIX-1365 being required does not move it
earlier — it still waits on FIX-1362 and FIX-1364. Seven issues under one epic will therefore
not run seven-wide, and expecting that throughput is how this epic gets read as stalled when it
is merely serial.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [FIX-1360](https://linear.app/fixpoint-labs/issue/FIX-1360) | Kitchen-sink drift audit (chat-agent + skill activator) | spec | — | — | Backlog |
| [FIX-1361](https://linear.app/fixpoint-labs/issue/FIX-1361) | Contract for the default `agent` kind — incl. the **omitted-`flow:` admission** (decided: it selects the built-in) and the **loud-fail rule** for an unregistered kind name | spec | — | — | Backlog |
| [FIX-1363](https://linear.app/fixpoint-labs/issue/FIX-1363) | Built-in `agent` flow kind | spec | — | — | Backlog |
| [FIX-1362](https://linear.app/fixpoint-labs/issue/FIX-1362) | Per-seat skill register + activate in the agent kind | spec | — | — | Backlog |
| [FIX-1364](https://linear.app/fixpoint-labs/issue/FIX-1364) | Memory attach on existing scopes + named gaps | spec | — | — | Backlog |
| [FIX-1366](https://linear.app/fixpoint-labs/issue/FIX-1366) | Atlas teach: OOTB agent kind | spec | — | — | Backlog |
| [FIX-1365](https://linear.app/fixpoint-labs/issue/FIX-1365) | Thin Proof: hire the OOTB agent kind — **required**, the epic's Goal 1 check | spec | — | — | Backlog |

*No child carries a Linear category label yet, so every route reads **spec** by the fail-closed
default ([`orchestration.md`](../../docs/contributing/orchestration.md) → "Which issues get a
spec"). Labelling one **Bug** re-routes it, and an empty Spec PR cell would then be correct.*

**Not children, deliberately:** FIX-1344 (W2 soft dep), FIX-1356 (W3 convention), FIX-1355 (W3
lab), FIX-1367 (thin `WorkerConfig` — W3 hire admission; the agent kind *consumes* that bag and
does not own its contract), persona builder, Collab. They are linked from theme 6 and must not be
re-parented here — Linear allows one parent, and they already have theirs.

## 5. Open cross-cutting questions

**Nothing is open. Every question this epic raised has an answer below.**

- **~~Does an instructions-only `WORKER.md` select the built-in kind, or must a seat name it?~~**
  *Resolved (Architect stamp, this PR, 2026-09-11 — explicitly "No D-n", so it is settled and
  not waiting on the owner):* **(a)** — an omitted `flow:` **selects** the built-in agent kind,
  and the built-in must reach the `kinds` map **without the app naming it**. A `WORKER.md`
  carrying only `instructions` is a complete seat at **zero config lines**, which is §1's
  headline promise. **(b) was rejected**: `flow: agent` plus explicit registration quietly
  narrows the headline into the same paper cut `defineAgent` already made people pay. The typo
  risk that was the stated mind-changer is **answered rather than traded away** — FIX-1361 owns
  both the contract *and* the loud-fail rule: an unregistered or misspelled kind name fails
  loudly and never silently hires the agent. FIX-1361 writes that contract; it does **not**
  re-open (a) vs (b). No second prompt system and no Agent L1 invention.
  Folded into §1, theme 5 and §4.

- **~~Does `persona` survive as a reserved future concept, or is it deleted with the
  `defineAgent` cluster in #1713?~~** *Resolved (Architect, this PR, 2026-09-11):* `persona`
  stays a **reserved later opinion** — a persona builder that compiles to a prompt — and never a
  hire key. PR #1713 may delete the `definePersona` / `defineAgent` surface outright; the
  reservation is conceptual, not a live symbol, so nothing here depends on it surviving.
  **FIX-1366 teaches `instructions` only and does not document an empty reserved `persona`**
  until there is a product surface to document. Every theme above stands either way.

- **~~Does FIX-1363 wait for FIX-1344's default worker system prompt, or define it?~~**
  *Resolved (Architect, this PR, 2026-09-11):* neither. FIX-1344 owns **shipping** the shared
  default worker system prompt; FIX-1363 **consumes** `prompt: [default, instructions]` and
  defines no second default-prompt config in this epic. Starting before part 2 lands is fine —
  `instructions` alone with an explicit seam for `default`. It does not block on the #1713
  deletion and it does not fork prompt composition. Net: FIX-1363 is unblocked by W2, not
  sequenced behind it. Folded into theme 2 and theme 6's table.

- **~~Does this epic close any of the lead measure, or only add surface?~~** *Resolved (D-4,
  Architect + Cycle PM on this PR, 2026-09-11 — explicitly not a Jake D-n):* **FIX-1365 is
  required**, not optional. It is the epic's Goal 1 check and the epic cannot finish without it.
  Sequencing is unchanged — still after FIX-1362 and FIX-1364; required does not mean
  parallelizable earlier — and it does not expand into Collab or a fat lab. Linear is stamped:
  FIX-1365 retitled "(required)", priority raised P4 → P2. Folded into §1, §3, §4.

---

## Epic evolution

- **Epic drafted (2026-09-11)** — the Architect's locked record turned into five sections. Two
  things added beyond transcription: the verified state of the FIX-1344 / FIX-1356 soft deps
  (theme 6), because "FIX-1344 is done" would mis-sequence FIX-1363; and the honest read that
  the set adds surface rather than goal checks (§1, §5), because the objective gate is where
  that is decidable and nowhere else is.
- **After epic-PR review, round 1 (2026-09-11)** — all three §5 questions closed as recorded
  decisions (persona reserved-but-unsurfaced; FIX-1363 consumes FIX-1344's default prompt with a
  seam; **FIX-1365 required**), and the set-composition challenge answered with seven kept plus a
  named collapse trigger on FIX-1361, because a pre-emptive fold trades a real contract gate for
  a guess. Two verified review findings became theme constraints — the built-in kind's admission
  (theme 5) and skills storage isolation (theme 7) — because each is a place a theme promised
  something the shipped surface does not yet do.
- **Admission fork answered, round 2 (2026-09-11)** — the one question left open at round 1 is
  now a recorded decision: an omitted `flow:` **selects** the built-in kind (Architect stamp on
  PR #1730, "No D-n"), so §1's headline is zero config lines rather than a promise conditional on
  a later call. The typo risk that was the stated mind-changer became a second obligation on
  FIX-1361 (loud fail on an unregistered kind name) rather than a reason to take the narrow
  answer. §1, theme 5, §4 and §5 were all re-derived — theme 5 had been the surface still reading
  "Until one is chosen, §1's headline path does not exist", which is exactly the sentence a child
  worker would have built against. §5 now carries no open questions.

- **Objective gate passed; index unchanged (2026-09-11)** — the epic is signed off on both
  channels (`epic approved` label plus an approving comment on PR #1730), so the set's issues are
  released to ramp. The review feedback outstanding after round 2 was an Architect fold-check
  carrying no ask and the approval itself, so **zero rounds** were spent and nothing above the bar
  was found. The running index is unchanged and verified against Linear: all seven children sit in
  Backlog with no spec or impl PR yet, and none carries a category label. One real defect was
  fixed — theme 6's dependency table was indented inside its list item, which Linear's markdown
  round-trip mangled by dropping the first three characters of every cell, so the Linear mirror
  read `| / FIX-1332 | erged** (PR #1701)`. That is the one table whose job is to stop FIX-1344
  being read as done, and Linear is the copy child issues read. Dedented at source; both copies now
  carry it intact.
