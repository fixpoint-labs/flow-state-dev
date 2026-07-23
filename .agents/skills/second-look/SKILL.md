---
name: second-look
context: fork
agent: general-purpose
description: Use when you want a retrospective re-examination of a branch, PR, a Linear issue's attached spec, or a named feature in the @flow-state-dev repo — to question whether the solution was (or will be) the right approach, whether it's overbuilt or carries YAGNI/speculative surface, what the 80/20 version would be, and whether building it revealed a simpler path. Read-only; produces a scannable findings table, no edits or tickets. Keywords: bloat, overbuilt, over-engineered, too much code, premature abstraction, YAGNI, 80/20, was this the best approach, cut scope, review spec before building, FIX-.
---

# Second Look

A read-only **retrospective approach review** of one change. It asks the question line-level review doesn't: *now that this is built, was it the right shape — and what's the lean version?*

This repo accumulates bloat because AI-generated code gets reviewed hard for correctness but not for **whether it should exist at all**. This skill is that missing pass. Its bias is the opposite of "add flexibility": it hunts for surface that can be removed.

**Output is an analysis report only.** No edits. No Linear tickets. The user decides what to do with it.

## Not this skill

| Job | Use instead |
|-----|-------------|
| Line-level correctness, bugs | `/code-review` |
| Line-level cleanup, dedup, dead lines | `/simplify` |
| Whole-codebase depth refactors | `improve-codebase-architecture` |
| Pattern conflicts / redundancy / philosophy drift | `audit-coherence` |

Second-look operates **above** line level: the approach, the requirements that drove it, and the API/abstraction surface. It does not chase individual lines.

**Its lane vs. coherence.** Second-look asks whether *this change's* surface earns its keep against *its own* requirement — overbuilt? YAGNI? what's the 80/20? Whether the change *duplicates or conflicts with a pattern elsewhere* is a coherence question, not this skill's — route that to `audit-coherence`. (Second-look is `review`'s **restraint** lens; audit-coherence is its **coherence** lens. They compose; they don't overlap.)

## Resolve the target

The target names one of three review objects. Resolve it first — the object and its size baseline differ:

| Target | Review object | Intent source | Size baseline |
|--------|---------------|---------------|---------------|
| `<PR#>` | the PR diff | `gh pr view <PR#>` | actual diff — `gh pr diff <PR#>` / `--patch` for `numstat` |
| no arg | current branch diff vs `main` | PR/commit messages | actual diff — `git diff --numstat main...HEAD` |
| `FIX-XXX` (Linear) | the **attached spec** — the *planned* approach, before/while it's built | the issue body | **forward estimate** — lines the spec would generate |
| `<name>` (feature/area) | the current code implementing it | the issue/PR/wave it came from | current LOC of the isolated surface |

- **`FIX-XXX`** → fetch the issue and its **attached spec document** via the Linear MCP tools. The issue body is the requirement; the spec is the approach under review. You're catching bloat *before it's written* — findings recommend cutting scope from the spec.
- **`<name>`** → use the `Explore` agent to **isolate the surface first** (which blocks/patterns/capabilities/files implement it), then review what's there. Pull the wave plan + journal under `docs/internal/waves/` or the originating PR for intent.

For diff and feature targets, pull the **real line counts** before estimating. Every Δlines number is anchored to that real size (or, for a spec, a stated forward estimate) — report the size in the verdict.

## Process

1. **Understand intent.** What is this change *for*? Read the intent source for the target (table above) — not just the code. You can't judge whether something is overbuilt without knowing the requirement it was meant to meet.
2. **Read the authority docs.** Skim the relevant `docs/architecture/*`, the BP index in `docs/contributing/best-practices.md`, and the relevant `docs/contributing/best-practices/<category>.md` for situational rule text. This is the guardrail against false positives: **a deliberate, documented contract is not bloat.** If the change implements something `docs/architecture/*` requires, it stays.
3. **Map actual usage** (diff/feature targets). Use the `Explore` agent to check how new surface is consumed: callers of new abstractions, readers of new config/options/params, downstream consumers of new schema fields/state/resources. This is what separates YAGNI from earning-its-keep — verify it, don't eyeball it. For a **spec** target there's no code yet — instead, judge each piece of proposed surface against the requirement and check whether the spec itself names a present consumer for it.
4. **Apply the five lenses** (below).
5. **Run each candidate through the calibration gate** (below). Most candidates die here. That's correct.
6. **Emit the report** in the exact shape under "Report".

## The five lenses

| Lens | The question it asks |
|------|----------------------|
| **Premise** | Was a smaller or different approach enough for the *actual* requirement? |
| **Requirement origin** | Which requirement/decision drove the size — and was that driver real, or assumed/speculative? Challenge the requirement, not just the code. |
| **YAGNI / speculative generality** | What abstraction, option, param, extension seam, scope, or schema field has **no present consumer**? |
| **80/20** | What's the version that delivers most of the value at a fraction of the surface? |
| **Hindsight** | What did building this reveal that opens a now-obvious simpler path? |

## FSD-specific bloat patterns

| Pattern | Smell | Leaner shape |
|---------|-------|--------------|
| Pattern/capability config option with no caller | Configurability nobody asked for | Drop the option; keep the one real path |
| Capability wrapping a single block | Indirection with no leverage | Inline the block; delete the capability |
| Sequencer steps for a requirement that didn't land | Dead branches in the pipeline | Remove the steps |
| Generator `outputSchema` fields never read downstream | Schema surface > consumed surface | Trim to consumed fields |
| One-adapter "seam" | Hypothetical seam (one adapter = hypothetical; two = real, per `improve-codebase-architecture/LANGUAGE.md`) | Collapse the indirection until a 2nd adapter is real |
| `project` scope where only `session` is read | Speculative scope | Narrow the scope |
| Defensive handling for impossible cases | Error paths that can't fire | Delete (CLAUDE.md §2) |
| Resources / state-ops written but never read | Unused state | Remove |

## Calibration gate

A candidate becomes a **finding** only if it passes **all five**:

1. **Concrete leaner alternative** — you can describe the smaller shape specifically, not "this could be simpler."
2. **Net removal worth the row** — the alternative removes meaningfully more than it adds. Quantify it. A net of a handful of lines is not a finding.
3. **Articulable loss** — you can state what is given up, and argue it isn't needed now. If you can't name the loss, you don't understand it well enough to recommend it.
4. **Bloat, not taste** — removable surface, not "I'd structure it differently." Taste is dropped.
5. **Not a documented contract** — `docs/architecture/*` or a BP doesn't deliberately require it.

**"Appropriately scoped" is a valid, common verdict.** Returning zero or two findings beats inventing weak ones. This skill is grounded, not reflexively critical — do not pad to look thorough.

### Red flags — you're nitpicking, stop

- A recommendation with no Δlines number, or a tiny one → drop it.
- "Could be more flexible / generic / configurable" → that is the *opposite* of this skill → drop it.
- A line-level or correctness nit → out of scope (`/code-review`, `/simplify`).
- Flagging something a doc or BP deliberately requires → re-read the doc → drop it.
- More than ~7 findings on a normal PR → you're nitpicking; keep the top few by Δlines.

## Report

Lead with the verdict and the table. Keep everything scannable — the user does not want a wall of text.

```
## second-look: <target>

**Verdict:** <Appropriately scoped | Some trimmable bloat | Materially overbuilt> — <one sentence>.
Scope: <diff → +<added> / −<removed> across <N> files | spec → ~<est> lines planned (forward estimate) | feature → ~<LOC> across <N> files>.

| # | Finding | Lens | Recommendation | Est. Δlines | Sev | Conf |
|---|---------|------|----------------|-------------|-----|------|
| 1 | <short> | YAGNI | <short> | −180 / +15 | High | High |
| 2 | <short> | Premise | <short> | −60 / +0 | Med | Med |
|   |         |      | **Net** | **−225** |     |      |

### Detail
**1. <title>** (`path/to/file.ts`) — <driver: the requirement/decision that caused it>. <what you'd give up, and why it's fine now>. (1–3 sentences. No code unless a 2-line sketch is genuinely clearer.)

### Considered & deemed justified
- `<thing examined>` — kept because <reason>.
```

Rules for the report:
- **Verdict + table first**, always. Detail and the justified list come after.
- The **Net** row is required — it's the at-a-glance bloat magnitude.
- **Δlines** uses removed/added (e.g. `−180 / +15`); removals are the point. For a **spec** target these are forward estimates — lines the leaner spec *avoids before they're written* — so say "(est.)" in the verdict and recommend cutting scope from the spec, not from code.
- **"Considered & deemed justified" is required**, even when it's two bullets. It proves the pass wasn't a hunt and records the deliberate keeps.
- Detail stays terse: driver + tradeoff, 1–3 sentences per finding.
