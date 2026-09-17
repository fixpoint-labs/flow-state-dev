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

## Open

**Rooms have no declaration surface at all, and two documents disagree about it.** W3's
`FIX-1352` describes rooms as "written in code" in one section and reports zero matches for any
room declaration API in another. Verified: `RoomManifest`, `createRoom`, `roomRegistry` and
`defineRoom` return **no matches** across `packages/`. Whether the file convention is therefore
introducing rooms or *replacing* a code surface changes what W3 ships and what its docs claim.

This is recorded as an ask rather than answered here, because it is a product call about what we
tell people rooms are — and it binds W3 and W4 both. It belongs on whichever epic reaches it first.
