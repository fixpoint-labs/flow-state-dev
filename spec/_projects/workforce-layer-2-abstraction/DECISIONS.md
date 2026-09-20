# Decisions — Workforce: Layer 2 Abstraction

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind **more than one epic**. A call that touches one epic belongs to that epic's own
`DECISIONS.md`; absorbing it here would make this a design nobody signed off.

---

### PD-1 · The test is not complexity — it is whether there is one of it

**Binds** every epic in the project, and every future one.

A concept belongs to Layer 1 when there is **exactly one** of it and correctness depends on that.
It belongs to Layer 2 when it is **one opinionated assembly among several valid ones**. A
convention may still carry real capability and be far more than config; being more than config
does not make it substrate.

Worked: **Task is substrate** — it is the claim system, and there is one of it. **Plan is a
convention** — there are any number of ways to express a plan with what FSD already has, including
a resource a flow writes to. Same for Strategy, Role, Archetype and Team.

**Rejected:** sorting by complexity, which puts anything hard into the substrate and leaves Layer 2
as config. **Costs** a concept that fails the test stays out even when it would be convenient to
put it here.

### PD-2 · Task moved to Layer 1

**Binds** FIX-1333 (the MCP door over boards), FIX-1407 (work routing), and anything that claims.

The task board began as an extension and is now core, because **claiming** is the thing correctness
depends on. Tasks are a unit of work with a goal, assigned to an agent — and there is one claim
system, so PD-1 puts it below the fence. It lives in `orchestration`.

**Costs** Layer 2 cannot redefine what a task is; a convention that wants different claim semantics
is asking for a second substrate and the answer is no.

### PD-3 · Agents are participants, not LLM-in-a-loop building blocks

**Binds** FIX-1332 (thin Agent), FIX-1359 (the default agent flow), and every archetype.

An Agent is a complete participant system. Internally it bundles a Persona, Skills, Memory,
Instructions and a Strategy; externally it is **invoked or assigned tasks, not decomposed**. That
is what makes `agent` a flow kind someone can replace wholesale rather than a pattern they wire.

**Rejected:** exposing the bundle as the API, which makes every consumer re-assemble an agent and
makes "replaceable" meaningless.

### PD-4 · The vocabulary is ratified by code shapes, not by agreement

**Binds** every epic; it is why the project is sequenced the way it is.

The model is not locked until concrete code ratifies it. This is why W2 (conventions and the seat
factory) ran first and why W3 carries **a thin pentest lab** rather than only readers: a convention
with no consumer has not been tested, it has been asserted.

**Costs** the propagation pass — in-flight tickets, docs IA, the README, renaming the patterns
package to strategies, the `agentType` field — waits for the lock and gets more expensive the
longer it waits. Accepted deliberately; a propagation pass over an unratified vocabulary is worse.

### PD-5 · The renames are settled, and old names are not alternatives

**Binds** every epic, every doc page, and the propagation pass.

Identity → collapsed to a system id field, Persona is the who-concept · Worker → **Role** ·
Pattern → **Strategy** · Pattern-skill → *a Skill that carries a Strategy* · Approach → Strategy ·
Prompt template → **Instructions** (concept) + `.md` + frontmatter (format) · `agentType` → **stream
visibility** · Actor → kept out of the primary vocabulary; Agent owns the slot.

**Room → Channel.** W3 folded the rooms / L2-channels dual into one file type on Sep 11. A channel
is declared as `CHANNEL.md` at team scope and is **L2 opinion — a replaceable flow kind, not a new
L1 type** (W3 D1). *Room* is a dead noun and may not appear in a new surface.

**Costs** code still carries old names until the propagation pass runs, so the tree and the
vocabulary disagree in the meantime. That gap is expected, not a defect to file.

---

## Decided once

Answers settled at project altitude, so no later epic reopens them.

| Question | Answer | Where it was settled |
|---|---|---|
| Does a Plan get a substrate primitive? | No — convention (PD-1) | Vocabulary pass, absorbed from the project's Linear content |
| Who owns the claim system? | Layer 1, `orchestration` (PD-2) | Same |
| Is an Agent decomposable by its consumer? | No (PD-3) | Same |
| Does the propagation pass run before the vocabulary locks? | No (PD-4) | Same |
| Is a channel an L1 type, and is *room* a second thing? | No to both — a channel is L2 opinion, a replaceable flow kind (W3 D1), and it replaced room | W3's objective and floor recut, Sep 11 |
| Does W4 wait for W3's vocabulary lock before it starts? | No — it starts; only its **ship** PRs wait. PD-4's rename-twice risk was held by W4's ship fence, not by keeping the epic shut. *(That fence's own fate is below, 1 — it expired unruled)* | W4's objective gate, Sep 19 |
| How many children did W4's gate ratify? | **Five** — FIX-1394, FIX-1405, FIX-1385, FIX-1408, FIX-1430; FIX-817 and FIX-1415 related-not-child. It **wrapped carrying seven**: FIX-1381 by the owner's word, FIX-1451 by a tracker correction. Whether that growth stayed inside the approved gate is *unresolved* (below, 5) | [#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) sign-off 2, approved Sep 19 02:49 ET |
| Does routing work — a coordinator assigning a queue across seats their own files name? | **Yes, proved on the real path.** No later epic re-proves it | W4's ER-20 **PASS**: three runs of `goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name`, `GOAL_FILER=model` on `vercel/openai/gpt-5.4-mini`, `e6ccb22` of `main`, **both negative controls red on that same path** |
| Does a busy seat take a second row concurrently? | **No — drain width is 1.** Work queues behind it. **Reversible:** the `MANAGER_QUEUE_DRAIN_WIDTH` knob stays | W4 ER-15, on the lab running at *both* widths rather than a number being picked |
| Is a board assignee a Workforce seat? | **No.** An assignee is a key on a ledger; a seat is a roster slot that mints a flow instance. They map **by composition** — no second `WorkerRegistry`, no assignable-channel routing | W4 D3 |
| How does work reach a child, and with what content? | Dispatch passes `parentSessionId`, bound **for life at mint**; parent history only by **opt-in tools**, never an ambient dump; the payload is the brief (`goal` / `constraints` / `acceptance` / `links`). **Linked is not nested** | W4 D4. Mechanism corrected by FIX-1430 reading the code: the parent bound is the **draining seat's** session, not the filer's |
| Is runtime inventory a helper or a resource? | **Two layers, and the fork is dismissed.** The declared roster composed at read time — public as `readDeclaredRoster(root)` — and the live org-scoped resource ChannelFlow updates as seats and channels open. They answer different questions | W4 D5; the export approved at the objective gate |
| What is a seat's package, and where do documents live? | One format, **authored in Markdown**, scoped to instructions and tools, two attachment modes (seat always-on, library opt-in), and **not disk-only** — packages will eventually be LLM-authored and stored as a resource, which binds the design now. **Documents are org-scoped**: v1 carries no per-seat document slot, and the exclusion is structural — a package attaches to one seat, a document installs at org scope | W4 ER-2, the owner's ratify Sep 19 · builds outside W4 as **FIX-1459** |
| What does a hireable worker kind have to accept? | **Four imposed keys, not three** — `instructions`, `teamInstructions`, `seatSkills`, `seatTools`. Compose `workerConfigSchema()`; a file that authors one is refused by name (PR-6) | Read off `packages/workforce/src/worker-config.ts` on `main`; `teamInstructions` shipped with FIX-1377 ([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911)) |
| Does `teams/<id>/` fence what a seat reads, or only address it? | **It addresses; it does not fence**, and the halves differ mechanically. Team *instructions* reach only that team's seats — they ride each seat's own config. Team *documents* install on a worker **kind**, so every seat of that kind reaches every team's | FIX-1377 shipped as written, FIX-1368 done, and the docs teach both rules out loud. **Settled by what shipped, not by a recorded ruling** — below |

## Recorded at the wrap, not decided

W3 and W4 both wrapped on Sep 20. These five came out of those wraps **with a status that is not
*settled***, and they keep it. Writing any into *decided once* would manufacture a ratification
nobody gave.

**1 · The ER-14 ship-fence narrowing was recommended, never answered — and has now expired
unruled.** W4's ER-14 fenced its ship PRs behind W3's implementing children. The epic recommended
narrowing that to *per-PR file overlap*; the owner never answered; the epic meanwhile ran an
**operating default inferred from his merge actions** — he merged #1928 through a live fence —
rather than from anything he said, and said so itself. Two things changed at the wrap: every W3
child is terminal, and **FIX-1435, the issue W4's re-gate named as the W3 child keeping the fence
live, has no parent in Linear at all**. On ER-14's own letter the release condition now reads
**satisfied**. Nobody ruled it discharged and nobody answered the narrowing; it stopped mattering
instead. An epic that wants a fence against another epic states its release condition in **merged
code**, not a package name, and inherits nothing from this one.

**2 · ER-7's third framework-owned key shipped without its re-confirm being recorded.** W3 held
`teamInstructions` behind an owner re-confirm, because adding it changed a spec he had already
approved. The key is now on `main` and the contract carries a **fourth**, `seatTools`, besides. The
contract is settled and is in *decided once*; the re-confirm W3 said no child would ship without is
recorded nowhere I can find. Stated here so nobody later reads the shipped code as evidence the
gate was met.

**3 · The `teams/<id>/` address-vs-fence fork was settled by what shipped, not by a ruling.** W3's
Open 6 was bound to FIX-1368's D2 — three live arms, two of three reviewers backing *address*.
FIX-1377 shipped as written, FIX-1368 is done, the published docs teach the address reading, and
**no artifact records the owner ruling on D2 by name**. The outcome matching the recommendation is
not the recommendation being accepted. Making `teams/<id>/` a real visibility boundary later is a
re-open of a shipped surface, not a correction.

**4 · Three things W4 named out at its wrap have no owner, and closing W4 gave none of them one.**

| Named out | State |
|---|---|
| **ER-19's repo-wide PR-5 rename** | Only the check over W4's own diff ran. The repo-wide pass is the project's, still gated on PD-4's vocabulary lock, and **has no owner** |
| **How a sub-agent's background work surfaces on a board row** | Orphaned when FIX-1385 shipped without a coordinator assign. Whoever takes it is bound by W4's ER-11 — a view, never a new status. **Unowned** |
| **A board id no channel minted** | Not refused: it silently resolves a second, empty ledger, with only `warnUnattendedBoards` as a signal. **No owner, no filed ticket** |

**5 · "W4 has grown past its ratified set" was routed to #1905, which closed without answering it.**
The set went from the ratified five to seven — one by the owner's word, one by a tracker correction
— and whether the newcomers sat inside W4's approved exit gate was #1905's to say. It closed
silent. Re-homed here because its surface is gone; **still unresolved**, and it is the question a
later epic should ask before letting its own set grow after a gate.

## Open

**`org/channels/` is still unbuilt — and the issue that owned it reads Done.** W3 ships channels at
**team** scope (FIX-1352, done); D3 locks `org/` and `teams/<teamId>/` as the same slots, and the
`org/` half of the channels reader was never built. It bound W3 and W4, which is why it is named
here rather than left inside one epic.

**What changed at the wrap makes this worse, not better.** FIX-1419 was filed for exactly this gap
— its description says *"the owner has decided to close the gap rather than continue carrying it as
a documented limitation"* — and it reads **Done**, closed 2026-09-18 in FIX-1421's batch. The code
disagrees: on `main`, `readChannelsDirectory` walks `teams/<teamId>/channels/` only, its own header
says so, `packages/workforce/README.md` says *"There is no `org/channels/` level"*, the atlas lists
it under **not shipped**, and a committed test plants an `org/channels/` file and **pins the
silence deliberately**. A declared, unread door carrying a closed ticket is worse than an unowned
one, because the next reader takes Done at its word. Whoever next touches the channel surface
builds the reader or reopens FIX-1419; nothing currently does either.

*An earlier version asked whether rooms had a declaration surface. The zero it found was the
`room` → `channel` fold (PD-5) working, not a gap.*

### Is W1 in scope, or held off the path? — needs the owner

**Plain terms.** An external Claude or ChatGPT client has no first-class way to send work into a
running Workforce, set focus, or read status. W1
([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)) is that door — either the fifth epic
this project owes, or something L2 finishes without. Evidence: [Spec](SPEC.md) → the epics table.

**The trade-off.** In scope, the project is not done until the door ships. Out, L2 is
feature-complete with the door shut — right if the two Labs are the proof, a promise quietly
withdrawn if anyone is waiting on external-client access.

**Recommendation — keep W1 an epic, record the hold on the issue.** The countdown's bar is what the
Labs need; this project's outcome is the larger claim, and both hold if W1 leaves the near arc and
stays on the list. Moving FIX-1333 to **On Hold** with a reason ends the ambiguity at its source.

**What would change my mind:** W1 was dropped, not deferred — answered elsewhere, or nobody is
waiting. Then it leaves the table and the outcome narrows.

**Cost of being wrong:** low and reversible; what is paid today is two surfaces answering a reader
differently about what this project owes.
