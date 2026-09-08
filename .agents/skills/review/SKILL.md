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
| **Alternatives** *(triggered)* | Is this the right *shape*, or did we stop at the first workable one? | `adhd` | change + codebase; **notes only, never must-fix** |

Coherence, Restraint, Depth, and Alternatives are standalone skills — **dispatch them; don't
re-derive their criteria here.** Correctness and Completeness have no standalone skill,
so their prompts live below.

**Restraint and Alternatives are opposite postures on purpose.** Restraint hunts surface to
remove; Alternatives generates shapes the change could have taken instead. Kept in one lens
they blunt each other — `second-look` explicitly drops any "could be more flexible" candidate,
which is most of what divergence produces. They compose; they don't merge.

## Resolve target & select lenses

- **A change (PR / branch / working diff):** Coherence + Restraint + Correctness, plus
  **Completeness when a spec or agent-brief is in scope** (pass it in). Depth optional.
- **A codebase slice / area:** Coherence + Restraint + Depth. (Correctness and
  Completeness need a diff / spec — skip.)

Give every lens the same target framing, `docs/philosophy.md`, and — for a change — the
spec.

**Alternatives is triggered, never standing.** It costs 8 sub-agent calls, and once the
code exists most alternatives are expensive regret — the spec is where they pay for
themselves. There are two ways in, and they are not the same:

- **An explicit request always runs it.** If the caller asked for the alternatives lens,
  run it. No exclusion below applies — the caller opted in, which is the same rule as
  `adhd`'s own pre-flight Step 1.
- **Automatic triggering** happens only when the change is genuinely shape-open: **new
  public API surface**, a **new pattern / capability / block kind**, a **schema or scope
  decision**, or a **spec whose §3 weighed no real alternative**.

**The exclusions below govern automatic triggering only.** Don't auto-add the lens to a bug
fix or a mechanical refactor. And an **approved spec that weighed a real alternative in §3**
suppresses every automatic trigger, including new public API surface: the divergence already
happened at the altitude where it was cheap and a human signed the result off, so re-running
it against shipped code pays twice to relitigate a settled decision. If someone asks for it
anyway, they get it.

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
   - **Alternatives** (if triggered) → run `adhd` in its **review context**, scoped to
     *other shapes this change could have taken*. Its switch test (materially different ·
     concretely describable · wins on a named axis · switch cost stated) does the pruning —
     don't re-derive it here. Its **alternatives rows** are always **notes** and never
     block. Its **routed findings** are not — those are correctness / restraint / coherence
     defects that divergence happened to walk into, returned tagged for you to classify;
     severity them as that lens would, up to and including must-fix. Note-only applies to
     the shapes, not to everything the lens hands back.
   - **Claude model tiering** (AGENTS.md): dispatch **Correctness** and **Completeness**
     on **Sonnet** — they check decided work. **Coherence**, **Restraint** and
     **Alternatives** keep the judgment tier (Opus, including Alternatives' fanout);
     **Depth** inherits its skill's tier. In **OMP**, use the native dispatch below
     instead; the lens selection and criteria are unchanged.
2. **Dedupe across lenses.** They overlap at the edges (a redundant capability is both a
   coherence conflict and bloat). Merge duplicate findings into one, attributed to the
   sharpest framing. Never double-count.
3. **Rank & categorize:** **must-fix** (bugs, spec gaps, coherence breaks) · **should-fix**
   (bloat, drift) · **note** (depth follow-ups, observations).
4. **Synthesize ONE report** — a verdict plus a single ranked table across all lenses,
   not four separate reports.

## OMP native dispatch

Harness adapter only. The **coordinator** runs this; `fsd-implementer` returns its
patch/evidence and never launches reviewers. Claude keeps the Agent-tool path above
and below. Shared lens selection and **Run** remain policy; this section supplies
only native roles, frozen inputs, leaf fences, and result validation.

| Selected lens | Native agent | Configured model role |
|---|---|---|
| Coherence | `fsd-coherence` | `@fsd_design_review` |
| Restraint | `fsd-restraint` | `@fsd_design_review` |
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
to the selected ordinary lenses in lower case; Alternatives uses the phase dispatch
below, not this findings schema. Dispatch one native task batch:

```js
const text = { type: "string", minLength: 1 };
const reviewSchema = {
  type: "object", additionalProperties: false,
  required: ["reviewedRevision", "lens", "verdict", "summary", "findings", "blockers"],
  properties: {
    reviewedRevision: { type: "string", const: reviewedRevision },
    lens: { enum: ["coherence", "restraint", "correctness", "completeness", "depth"] },
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
  agent: lens === "depth" ? "fsd-coherence" : `fsd-${lens}`,
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

For selected Alternatives, the coordinator runs `adhd` in review context, retaining
its orchestration, scoring and clustering. Each frame/focus leaf uses `fsd-coherence`
with an explicit **Alternatives phase, not coherence critique** assignment and strict
phase schemas matching `adhd`'s outputs. Preserve its isolation and collect both waves;
do not coerce generative outputs into ordinary findings or switch the user's session
model. Shared **Run** governs pruning, routing and severity.

### Validate the round

The coordinator resolves conflicting claims against frozen evidence, not model vote.
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
  Restraint = `second-look`, Depth = `improve-codebase-architecture`, Alternatives = `adhd`.
- **Don't run Alternatives by reflex.** It is the one lens with a cost gate on it; a review
  that adds it to every change has stopped reading the trigger list.
- **Dedupe.** Overlapping lenses produce one merged finding, never repeats.
- **Don't pad.** A lens that finds nothing says so in one line; "appropriately scoped /
  coherent" is a valid, common verdict.
