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
| Does W4 wait for W3's vocabulary lock before it starts? | No — it starts; only its **ship** PRs wait. PD-4's rename-twice risk is held by W4's ship fence, not by keeping the epic shut | W4's objective gate, Sep 19 |
| How many children does W4 carry? | Five — FIX-1394, FIX-1405, FIX-1385, FIX-1408, FIX-1430. FIX-817 and FIX-1415 are related-not-child | [#1905](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) sign-off 2, approved Sep 19 02:49 ET; re-homed in Linear 03:04 UTC |

## Open

**`org/channels/` is locked open, read by nothing, and owned by no issue.** W3 ships channels at
**team** scope (FIX-1352, done); the `org/` door is declared and unread — the open half of its
D3/D7. It bound W3 and W4, which is why it was named here rather than left inside one epic —
and **both epics wrapped on Sep 20 without closing it**. It now belongs to whichever epic next
touches the channel surface, and nothing currently does.

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
