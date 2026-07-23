---
name: review
context: fork
agent: general-purpose
description: The single definition of how we review. Composes the review lenses as parallel sub-agents — coherence, restraint (bloat), correctness, and (for a change with a spec) completeness, plus optional depth — over a change (PR / branch / working diff) or a codebase slice, then dedupes and synthesizes ONE ranked report. Run standalone on any PR/branch/area, and invoked by issue-implement at the end of its work so there is one review, not a per-skill panel.
argument-hint: "<PR# | branch | area | (empty = working diff vs main)>"
---

# Review

One definition of *how we review*, composed of independent **lenses** run as parallel
sub-agents. The same lenses apply whether you're reviewing an in-flight change or
auditing a codebase slice — only *which* run, and their scope, differ. `issue-implement`
calls this skill at the end of its work; run it standalone on any PR, branch, or area too.

**Why one skill.** The lenses used to be defined twice — once as the issue-implement
review panel, once as the standalone audit skills. Now there is one composition point
(tenet 2, composition). Each lens is also a standalone skill; `review` runs the right
set together and merges the results.

## The lenses

| Lens | Question | Implemented by | Applies to |
|---|---|---|---|
| **Coherence** | Does it cohere with the philosophy and the patterns around it? | `audit-coherence` | change + codebase |
| **Restraint** | Should this exist? overbuilt / YAGNI / 80-20? | `second-look` | change + codebase |
| **Correctness** | Bugs, logic errors, and the second-path checklist (BP-035)? | code-reviewer sub-agent (below) | change |
| **Completeness** | All of the spec built, nothing extra, red shown, goal proven? | spec-compliance sub-agent (below) | change **with a spec** |
| **Depth** *(optional)* | Shallow modules introduced or nearby? | `improve-codebase-architecture` | change + codebase; **non-blocking follow-ups** |

Coherence, Restraint, and Depth are standalone skills — **dispatch them; don't
re-derive their criteria here.** Correctness and Completeness have no standalone skill,
so their prompts live below.

## Resolve target & select lenses

- **A change (PR / branch / working diff):** Coherence + Restraint + Correctness, plus
  **Completeness when a spec or agent-brief is in scope** (pass it in). Depth optional.
- **A codebase slice / area:** Coherence + Restraint + Depth. (Correctness and
  Completeness need a diff / spec — skip.)

Give every lens the same target framing, `docs/philosophy.md`, and — for a change — the
spec.

## Run

1. **Dispatch the selected lenses as parallel sub-agents** (they're independent).
   - **Coherence** → run `audit-coherence` scoped to the target. On a change with a
     spec, it reads the spec's Part I ("The Case") and the *shape* of the diff, judging
     whether the solution coheres with the tenets it claims — the "directionally-right
     spec but the design feels off" failure the other lenses can't see. Its verdict is
     the most consequential: a coherence break usually means reshaping the approach, not
     patching lines.
   - **Restraint** → run `second-look` on the target.
   - **Correctness** → the prompt below.
   - **Completeness** (change with a spec) → the prompt below.
   - **Depth** (if selected) → run `improve-codebase-architecture` on the touched
     area; its output is *candidate follow-ups*, non-blocking.
   - **Model tiering** (AGENTS.md): dispatch **Correctness** and **Completeness** on
     **Sonnet** — they check *decided* work against the spec/checklist, not open design.
     **Coherence** and **Restraint** keep the judgment tier (Opus, the default); **Depth**
     inherits its skill's tier.
2. **Dedupe across lenses.** They overlap at the edges (a redundant capability is both a
   coherence conflict and bloat). Merge duplicate findings into one, attributed to the
   sharpest framing. Never double-count.
3. **Rank & categorize:** **must-fix** (bugs, spec gaps, coherence breaks) · **should-fix**
   (bloat, drift) · **note** (depth follow-ups, observations).
4. **Synthesize ONE report** — a verdict plus a single ranked table across all lenses,
   not four separate reports.

## Correctness lens (prompt)

```
Agent tool (superpowers:code-reviewer, model: sonnet):
  Review the change for quality (naming, structure, test coverage) and bugs/logic errors.
  Run the SECOND-PATH CHECKLIST (BP-035) against the changed surface — treat an unhandled
  path as must-fix unless explicitly out of scope:
    - legacy / persisted records (BP-030); null / empty / boundary inputs and guard-clause
      order; concurrent / duplicate (409) calls; cancel / error paths (ctx.signal, cleanup
      on synchronous throw); second-tenant key scoping (BP-031); cost / observability of any
      new model or tool call; React derived-state / no-op render (BP-010).
  Verify conventions (AGENTS.md, best-practices.md). Check the changeset (BP-022): one
  user-facing sentence per affected package, patch/minor only pre-1.0; internal-only →
  `pnpm changeset --empty`.
```

## Completeness lens (prompt — change with a spec only)

```
Agent tool (general-purpose, model: sonnet):
  Verify the implementation against the spec by reading the code, not the report.
    - Everything the spec requires is implemented; nothing extra that the spec didn't ask for.
    - Edge cases from the spec are handled; the testing strategy was followed.
    - RED was demonstrated: every new behavioural / regression test has the actual failing
      output captured BEFORE the fix existed, plus the passing output after. "Tests pass"
      with no failing-output evidence is rejected — require re-demonstration. (Exceptions:
      pure characterization/parity holding pre-existing tests green; trivial mechanical edits.)
    - GOAL proven: if the spec names a goal check, confirm it ran on a real model and passed
      (a green CI suite is not evidence); if it wasn't, that's a must-fix — run it before
      presenting. Honor a documented "no goal check applies" only if no user-observable
      outcome was introduced. For bugs, verify diagnose's real-path confirmation instead.
  Full template: ../issue-implement/spec-reviewer-prompt.md.
```

## Report

Verdict + a single ranked table (`finding · lens · severity · where · recommendation`),
must-fix first. One "considered & clean" line per lens that found nothing. When run by
`issue-implement`, must-fix and should-fix are resolved before it presents; notes flow
to its summary.

## Guardrails

- **Dispatch the standalone lenses; don't reimplement them.** Coherence = `audit-coherence`,
  Restraint = `second-look`, Depth = `improve-codebase-architecture`.
- **Dedupe.** Overlapping lenses produce one merged finding, never repeats.
- **Don't pad.** A lens that finds nothing says so in one line; "appropriately scoped /
  coherent" is a valid, common verdict.
