---
name: review
context: fork
agent: general-purpose
description: The single definition of how we review — looking for flaws in the work (whether it is the right approach is `analysis`). Composes the review lenses as parallel sub-agents — coherence, restraint (bloat), reuse (compose existing pieces), correctness, and (for a change with a spec) completeness, plus optional depth — over a change (PR / branch / working diff) or a codebase slice, then dedupes and synthesizes ONE ranked report. Run standalone on any PR/branch/area, and invoked by issue-implement at the end of its work so there is one review, not a per-skill panel.
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
| **Reuse** | Does each Adds item compose an existing piece, or add a second mechanism? | `reuse-review` | spec / epic / change (not a codebase slice) |
| **Correctness** | Bugs, logic errors, and the second-path checklist (BP-035)? | code-reviewer sub-agent (below) | change |
| **Completeness** | All of the spec built, nothing extra, red shown, goal proven? | spec-compliance sub-agent (below) | change **with a spec** |
| **Depth** *(optional)* | Shallow modules introduced or nearby? | `improve-codebase-architecture` | change + codebase; **non-blocking follow-ups** |

Coherence, Restraint, Reuse, and Depth are standalone skills — **dispatch them; don't
re-derive their criteria here.** Correctness and Completeness have no standalone skill,
so their prompts live below.

**Whether this was the right approach is [`analysis`](../analysis/SKILL.md), not a lens here**
([`orchestration.md`](../../../docs/contributing/orchestration.md#analysis-and-review)).
Other shapes (`adhd`) belong there. On a shipped change, run `analysis` directly.

**Reuse is not Restraint.** Restraint asks whether *this* surface earns its keep.
Reuse asks whether an Adds item is a *duplicate mechanism* — a second cap, marker,
release path, or a hook where block composition would do. The rule is
[`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces).

## Resolve target & select lenses

- **A change (PR / branch / working diff):** Coherence + Restraint + Reuse + Correctness, plus
  **Completeness when a spec or agent-brief is in scope** (pass it in). Depth optional.
- **A spec or epic PR / retained spec:** Coherence + Restraint + **Reuse** (required). The
  reuse lens is how every spec and epic gets this pass; do not fold it into Restraint.
- **A codebase slice / area:** Coherence + Restraint + Depth. (Correctness,
  Completeness, and Reuse need a diff / spec — skip.)

Give every lens the same target framing, `docs/philosophy.md`, and — for a change — the
spec.

**Every change gets the job check, whether or not its direction is settled.** Tell the Coherence lens:
a way to do a job that the diff adds and the spec's question-7 line (`issue-spec` Step 3.5)
doesn't name is a direction finding. It is routed to the ask, never to an implementer note.
The definition and the ask are in
[`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) → "When
approving adds a way to do a job". A bug-route change has no spec, so everything it adds counts.

## Run

1. **Dispatch the selected lenses as parallel sub-agents** (they're independent).
   - **Coherence** → run `audit-coherence` scoped to the target. On a change with a
     spec, it reads the spec's `SPEC.md` and `DECISIONS.md` and the *shape* of the diff, judging
     whether the solution coheres with the tenets it claims — the "directionally-right
     spec but the design feels off" failure the other lenses can't see. Its verdict is
     the most consequential: a coherence break usually means reshaping the approach, not
     patching lines. Tell it glue between our own mechanisms is a finding against the model
     ([`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces)).
   - **Restraint** → run `second-look` on the target.
   - **Reuse** → run `reuse-review` on the target (spec, epic, or implementation
     change). Do not skip it on a spec because Restraint already ran.
   - **Correctness** → the prompt below.
   - **Completeness** (change with a spec) → the prompt below.
   - **Depth** (if selected) → run `improve-codebase-architecture` on the touched
     area; its output is *candidate follow-ups*, non-blocking.
   - **Claude model tiering** (AGENTS.md): dispatch **Correctness** and **Completeness**
     on **Sonnet** — they check decided work. **Coherence**, **Restraint** and **Reuse** keep
     the judgment tier (Opus); **Depth** inherits its skill's tier. In **OMP**, use the native dispatch below
     instead; the lens selection and criteria are unchanged.
2. **Dedupe across lenses.** They overlap at the edges (a redundant capability is both a
   coherence conflict and bloat). Merge duplicate findings into one, attributed to the
   sharpest framing. Never double-count. Note which lens(es) raised each merged finding.
3. **Different-family judge (when more than one lens ran).** After the first-pass lenses
   return, dispatch **one** readonly judge on a **different model family** from the
   parent (Claude vs Grok vs GPT — pin `model` explicitly). It sees the merged finding
   list by sanitized label, not by lens name or model, and scores each as
   act-on / consider / noted / dismissed. Agreement with your ranking confirms it;
   disagreement means you or the rubric is biased — read both before deciding.
   Skip the extra judge on a single-lens run; it has nothing to cross-check.
4. **Agreement map, then rank.** Findings **two or more lenses (or the judge and a
   lens) raised independently** rank highest. A lone lens's finding is still read;
   weight it lower. If one lens flags something and another explicitly contradicts
   it, that disagreement is context for the verdict, not a vote.
   Bucket each merged finding, then map onto the existing severity:
   **act-on → must-fix** (bugs, spec gaps, coherence breaks) · **consider → should-fix**
   (bloat, drift) · **noted → note** (depth follow-ups, observations) ·
   **dismissed** — dropped, with a one-line reason (wrong, nit, missing context).
   Dismissed findings do not appear in the ranked table; they appear in the
   agreement map so a reader can see what was considered and why it died.
5. **Synthesize ONE report** — a verdict, the agreement map (where lenses/judge
   agreed and diverged, and what that pattern tells you), plus a single ranked
   table across all lenses, not four separate reports.

## OMP native dispatch

Harness adapter only. The **coordinator** runs this; `fsd-implementer` returns its
patch/evidence and never launches reviewers. Claude keeps the Agent-tool path above
and below. Shared lens selection and **Run** remain policy; this section supplies
only native roles, frozen inputs, leaf fences, and result validation.

| Selected lens | Native agent | Configured model role |
|---|---|---|
| Coherence | `fsd-coherence` | `@fsd_design_review` |
| Restraint | `fsd-restraint` | `@fsd_design_review` |
| Reuse | `fsd-coherence`, explicitly assigned **Reuse only** | `@fsd_design_review` |
| Correctness | `fsd-correctness` | `@fsd_code_review` |
| Completeness | `fsd-completeness` | `@fsd_code_review` |
| Depth | `fsd-coherence`, explicitly assigned **Depth only** | `@fsd_design_review` |

Dispatch only the selected lenses, not every role on every task. Agent frontmatter
resolves the model aliases; do not pass Claude model names or a task `model` field.
Unavailable roles/models are visible blockers, not grounds to silently substitute a
different reviewer or drop a selected lens.

### Freeze the review input

Before fanout, the coordinator captures one immutable review bundle outside the
mutable checkout. Record the exact base and head commit SHAs (never just a moving
branch/PR name), the target scope, intent, spec/brief version, and verification logs.
Provide readable base/head source snapshots and a diff, including surrounding code
and callers needed by the lenses; reviewers cannot use shell/git to recover them.
Capture line counts for Restraint. Snapshot the relevant authority documents too.
For spec-backed work, snapshot the canonical retained set, `SPEC.md` and `DECISIONS.md`
(a set retained in the older shape may also carry `BUSINESS-RULES.md`, `PLAN.md`,
`DOCS.md` or `EVOLUTION.md`; snapshot those too), with exact predecessor anchors and
approved/merged revision provenance. Read current code/docs separately: historical intent
is not shipped behavior. Check documentation publication against the spec's docs line, the
change against its debt verdict, partial/multiple-predecessor treatment, and POC isolation
through the existing lenses. Do not substitute a Linear mirror or superseded design.

For a dirty working diff, include both the committed change and the complete
staged/unstaged delta: capture `git diff --binary HEAD`, plus the bytes and paths of
all in-scope untracked files (which git diff omits). Preserve deletes, modes, and
binary changes. Keep unrelated dirt out only with an explicit scope manifest.
Capture while writers are paused; compute a content hash of the bundle manifest,
including every captured file/patch/spec/evidence hash. Use
`<base SHA>..<head SHA>+<bundle hash>` as `reviewedRevision` (the bundle hash also
identifies clean snapshots). Do not call a live checkout immutable or assume task
isolation automatically includes uncommitted files. Missing or unreadable snapshot
content must surface as blocked; materialize needed files before review proceeds.

Every lens gets the same manifest and source roots. Freeze them through the round;
no sibling findings, implementer assurances, or proposed adjudication in first-pass
prompts. Factual verification logs and the approved contract are shared evidence.
Later writes create a new bundle/revision; never carry a clean verdict forward as
approval of changed bytes.

### Leaf contract and native API

Native reviewers are read-only leaves. Apply only the assigned lens's shared skill
or prompt; do any small exploration directly, not its nested Explore/Agent calls.
Do not run validation, edit, subscribe/create mailbox handles, publish, or spawn.
Ask for missing evidence through `blocked`; a missing **required** goal/red check
is still a finding under the existing Completeness criteria, not a waiver.

Use the following shared schema with `schemaMode: "strict"`. `summary` retains
lens-specific context (e.g. Restraint's size baseline and justified keeps);
`detail` retains its required analysis (kind/routing, Δlines, loss/tradeoff, etc.).
Each evidence string must cite a captured path:line or log/spec reference and the
observed fact supporting the finding; a filename alone is not evidence.

In JavaScript Eval, set `reviewedRevision` to the captured identity and `reviewBrief`
to the shared scope, bundle paths, spec and evidence references. Set `selectedLenses`
to the selected lenses in lower case. Dispatch one native task batch:

```js
const text = { type: "string", minLength: 1 };
const reviewSchema = {
  type: "object", additionalProperties: false,
  required: ["reviewedRevision", "lens", "verdict", "summary", "findings", "blockers"],
  properties: {
    reviewedRevision: { type: "string", const: reviewedRevision },
    lens: { enum: ["coherence", "restraint", "reuse", "correctness", "completeness", "depth"] },
    verdict: { enum: ["clean", "findings", "blocked"] },
    summary: text,
    findings: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["title", "severity", "where", "evidence", "recommendation", "detail"],
        properties: {
          title: text,
          severity: { enum: ["must-fix", "should-fix", "note"] },
          where: text,
          evidence: { type: "array", minItems: 1, items: text },
          recommendation: text,
          detail: text
        }
      }
    },
    blockers: { type: "array", items: text }
  }
};
const reviewTasks = selectedLenses.map(lens => ({
  name: `Fsd${lens[0].toUpperCase()}${lens.slice(1)}`,
  agent: (lens === "depth" || lens === "reuse") ? "fsd-coherence" : `fsd-${lens}`,
  task: `# Target\n${reviewBrief}\nReviewed revision: ${reviewedRevision}
# Change
Read only. Apply the ${lens} lens from the shared review skill, not the full loop.
Independent first pass; do not consult sibling reports.
Skip all validation, builds, tests, linters, formatters, and runtime probes.
# Acceptance
Return the strict review schema for ${lens} with cited evidence or explicit blockers.`,
  outputSchema: {
    ...reviewSchema,
    properties: { ...reviewSchema.properties, lens: { const: lens } }
  },
  schemaMode: "strict"
}));
const reviewJobs = await tool.task({
  i: "Dispatching independent FSD reviews",
  context: `# Goal\nReview ${reviewedRevision}.
# Constraints
Read only; no validation or external messages. No first-pass cross-contamination.
# Contract
All reviewers inspect the same frozen bundle. The coordinator alone adjudicates,
dispatches accepted fixes, and synthesizes. Missing evidence is never approval.
${reviewBrief}`,
  tasks: reviewTasks
});
display(reviewJobs);
```

Collect **every** selected job from the returned IDs/artifact handles; completion is
asynchronous. Do not use oneshot `completion` for a source-reading reviewer.

### Validate the round

The coordinator resolves conflicting claims against frozen evidence, not model vote.
The different-family judge in **Run** step 3 is a cross-check on the merged list, not
a vote that overrides evidence.
Only after all first passes finish may it request targeted clarification or dispatch
accepted fixes; changed bytes require a new bundle/revision and affected re-review.

Check schema **and semantics**: a clean result has no findings/blockers; findings
requires at least one finding and no blockers; blocked requires a concrete blocker
and may retain partial findings. Reject wrong revisions/lenses, unsupported
evidence, or invalid output. A failed, missing, timed-out, or blocked selected
reviewer means **review incomplete**, never clean/approved. Show each such failure
alongside completed findings in the one synthesized report; retry or obtain the
missing evidence before clearing that gate. Approval applies only to the stated
reviewed revision.

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
  Verify conventions (AGENTS.md, best-practices.md). Changesets (BP-022) are NOT required by
  default — do not flag a missing one. Flag only a fragment that is present and wrong: it
  describes something no consumer of a published package can observe, it names a private
  package (`labs/*`, `examples/*`, `apps/*`, `plugins/*`, `goals`), it omits its Linear issue,
  it reads like a PR description, or it picks `major` pre-1.0.
```

## Completeness lens (prompt — change with a spec only)

```
Agent tool (general-purpose, model: sonnet):
  Verify the implementation against the spec by reading the code, not the report.
    - Everything the spec requires is implemented; nothing extra that the spec didn't ask for.
    - Cases the spec names are handled and tested.
    - The debt verdict holds: what the spec's debt table says goes is gone, and the change
      adds no debt the table doesn't list (a second way to do a job, a shim, a special case).
    - RED was demonstrated: every new behavioural / regression test has the actual failing
      output captured BEFORE the fix existed, plus the passing output after. "Tests pass"
      with no failing-output evidence is rejected — require re-demonstration. (Exceptions:
      pure characterization/parity holding pre-existing tests green; trivial mechanical edits.)
    - GOAL proven: if the spec names a goal check, confirm it ran on a real model and passed
      (a green CI suite is not evidence), AFTER its named control was run and failed on the
      signal the spec names, not just on its leg; and that none of `SPEC.md`'s *not done if*
      states holds. A PASS with no control FAIL is unproven. A browser check run by `fsd-qa`
      counts only when its mailbox verdict names the PR's head SHA. If it wasn't run, that's a
      must-fix — run it before presenting. Honor a documented "no goal check applies" only if
      no user-observable outcome was introduced. For bugs, verify diagnose's real-path
      confirmation instead.
  Full template: ../issue-implement/spec-reviewer-prompt.md.
```

## Report

Verdict + an **agreement map** (which findings 2+ lenses/judge shared, where they
diverged, what was dismissed and why) + a single ranked table
(`finding · lens · severity · where · recommendation · raised-by`), must-fix first.
One "considered & clean" line per lens that found nothing. When run by
`issue-implement`, must-fix and should-fix are resolved before it presents; notes flow
to its summary.

> **Attribution.** The agreement map, the four buckets, and the different-family
> judge are adapted from the MIT-licensed **pstack** `interrogate` and `arena`
> skills by Lauren Tan — <https://github.com/cursor/plugins/tree/main/pstack>.
> They add a merge step; they do not replace the lenses or the
> must-fix / should-fix / note scale.

## Guardrails

- **Dispatch the standalone lenses; don't reimplement them.** Coherence = `audit-coherence`,
  Restraint = `second-look`, Reuse = `reuse-review`, Depth = `improve-codebase-architecture`.
- **Dedupe.** Overlapping lenses produce one merged finding, never repeats.
- **Weight by agreement, don't average.** Two lenses naming the same defect outrank a
  singleton. A contradiction is a reason to read both, not to split the difference.
- **Don't pad.** A lens that finds nothing says so in one line; "appropriately scoped /
  coherent" is a valid, common verdict.
