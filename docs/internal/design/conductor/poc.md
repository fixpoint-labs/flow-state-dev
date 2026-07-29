# Conductor POC — the shape of the config and extension surface

**Date:** 2026-07-29
**Status:** SHAPE SKETCH. Companion to [`../conductor.md`](../conductor.md) — read that first
for the model, the decisions, and the diagrams.
**What this is not:** runnable code. The imports resolve to a package that doesn't exist yet.
It lives under `docs/` deliberately, so nothing here is compiled, linted, or shipped. Judge it
on shape, not on whether it builds.

The question this answers: **conductor is a config-based system — so what does a project
actually write?** Four levels, each additive. A project at level 4 still runs the level-1
defaults for everything it hasn't overridden.

---

## The file tree a project ends up with

```
my-project/
  conductor.config.ts          # level 1–2: the only required file
  .conductor/
    process/                   # level 3: the process files, copied from the template on init
      spec/SKILL.md            #   how a spec gets written
      implement/SKILL.md       #   how implementation runs
      review/SKILL.md          #   how a PR gets reviewed
      retrospective/SKILL.md   #   how a lesson gets extracted
    guidance/                  # the guidance collection's seed content
      objectives/*.md          #   { kind: objective, label, body }
      tenets/*.md              #   { kind: tenet, ... }  ← e.g. philosophy.md lives here
      lessons/*.md             #   written by the retrospective phase
    blocks/                    # level 4: your own blocks
      security-review.ts
    phases/                    # level 4: your own phases
      security.ts
```

`.conductor/` is versioned with the repo — the process is part of the codebase, not hidden in
a service. Editing a `SKILL.md` is how you change how a phase behaves, and it shows up in code
review like any other change.

**Why files rather than an FSD store:** conductor delegates the work inside a phase to a vendor
harness (Claude Code, Codex), and that harness reads *the repo* — not conductor's resources. So
anything both layers need is a file. See `conductor.md` §6, "Conductor over the vendor harness." Two
consequences visible in the tree above: front-matter carries the metadata both layers read
(`kind`, `label`), and conductor's own bookkeeping lives in a separate FSD-only resource keyed by
file path, so the vendor harness can rewrite a document without clobbering our accounting.

**Being a file isn't enough to be *found*.** Claude Code reads `CLAUDE.md` and `.claude/skills`;
Codex reads `AGENTS.md`. Neither knows `.conductor/guidance/` exists. So exposure is two
mechanisms (`conductor.md` §6, "Getting guidance into the vendor harness"): the **phase brief**
carries the relevant guidance as file references per dispatch — precise and vendor-agnostic — and
conductor maintains a **generated, marked block** in `CLAUDE.md` / `AGENTS.md` pointing at the
directory, for when a human drives the harness directly. A **pointer, never a copy**: inlining
guidance into `CLAUDE.md` would put one fact in two places with no authority rule, with a stale
copy as the failure mode.

```md
<!-- CLAUDE.md — conductor rewrites only between these markers -->
<!-- conductor:guidance:start -->
## Project guidance (managed by conductor)

Objectives and tenets live in `.conductor/guidance/`. Read the relevant ones before any
design decision. Do not edit `lessons/` by hand — the retrospective phase writes them.
<!-- conductor:guidance:end -->
```

---

## Level 1 — out of the box

One file, and it is nearly empty — because everything in it can be discovered.

```ts
// conductor.config.ts
import { defineConductor } from "@flow-state-dev/conductor";

export default defineConductor();
```

That's the honest level 1. Nothing above is a placeholder for values you'd fill in later:

| Not configured | Discovered from |
|---|---|
| the repo | `git remote get-url origin` in the repo conductor is running inside — it's sitting in a git checkout, so asking is redundant |
| GitHub auth | `GITHUB_TOKEN` / `GH_TOKEN`, the convention `gh` already uses |
| the dispatcher | the vendor harness that's actually installed (the `claude` CLI, then `codex`); a clear error if none resolves, not a silent default |
| the default branch | the remote's HEAD |

**Discover, don't ask.** A required config field that could have been read from the
environment is a knob that shouldn't exist (tenet 3), and it's worse than a no-op: it's a
second place for the same fact to live, which is the D1 mistake at config altitude. Every knob
in level 2 exists because it encodes an *intent* the environment cannot reveal — how many
issues to run at once, which vendor reviews, what the budget is.

Explicit values stay available for the cases inference genuinely can't cover: a fork where the
PRs should target upstream, several remotes, or one conductor driving a repo it isn't inside.

That gets the whole default process from `conductor.md` §8: epic framing → objective gate →
per-issue spec → spec gate → implementation → PR feedback → merge gate → retrospective. Three
human gates, no auto-merge, the process files from the shipped template.

```bash
pnpm conductor init          # scaffolds .conductor/ from the template
pnpm conductor start FIX-123 # put one issue under management
pnpm conductor board         # the board view
pnpm conductor tick          # fire a tick by hand (the CLI trigger)
```

**GitHub is the one connector that isn't optional** — it holds the artifacts and the gates
(§10/D1) — but "not optional" means auto-installed, not hand-declared. Linear is absent here and
everything works.

Note that "the GitHub connector" and "the Chat SDK's GitHub adapter" are different things doing
different jobs: the connector reads PR state and performs structural writes (open, merge, label,
submit a review); the chat adapter carries *conversation* on issue and PR threads. Conductor uses
both (`conductor.md` §7).

---

## Level 2 — configure

Same file, more of it. Nothing structural: knobs on the defaults.

```ts
// conductor.config.ts
import { defineConductor, linearConnector } from "@flow-state-dev/conductor";
import { claudeCodeDispatcher, codexDispatcher } from "@flow-state-dev/conductor/dispatchers";

export default defineConductor({
  // `repo`, GitHub auth, and the default branch are still inferred — override only
  // when inference can't be right (a fork targeting upstream, multiple remotes).

  connectors: [
    // GitHub is installed automatically; name it only to override something.
    // Optional. Outbound projection by default; inbound is explicitly opt-in,
    // and an inbound status change arrives as a SIGNAL, never a ledger write.
    linearConnector({
      apiKey: process.env.LINEAR_API_KEY!,
      teamKey: "FIX",
      sync: "outbound",           // "outbound" | "bidirectional" | "off"
      reactToStatusChange: true,  // a human dragging a card emits `external_status_changed`
    }),
  ],

  // Per-phase dispatch. Vendor choice is a config value, not a rewrite —
  // this is the anti-lock-in claim made concrete.
  dispatcher: {
    default: claudeCodeDispatcher({ model: "claude-opus-5" }),
    review: codexDispatcher(),                                  // second opinion from another vendor
    retrospective: claudeCodeDispatcher({ model: "claude-haiku-4-5-20251001" }),
  },

  concurrency: { issues: 4, perEpic: 3 },

  gates: {
    // Defaults shown. Loosening a gate is deliberate and visible in the diff.
    epicObjective: "human",
    specApproval: "human",
    merge: "human",              // "auto" is not an accepted value. Conductor never merges.
  },

  review: {
    rounds: 2,                   // the convergence budget from orchestration.md
    onExhausted: "converge",     // "converge" | "escalate"
  },

  // Two inbound transports with a clean division of labour — see conductor.md §7,
  // "Transports: conversation and state."
  triggers: {
    // STATE events. The gates turn on these, and the GitHub chat adapter does not
    // emit them: review submissions, merges, CI conclusions, conflicts.
    webhook: true,
    cron: "*/10 * * * *",        // backstop + new-work discovery
    // CONVERSATION. The Chat SDK has an official GitHub adapter that models issues
    // and PRs as threads and comments as messages — so a human commenting on a PR
    // and a human asking in Slack are the same primitive, one binding for both.
    chat: {
      platforms: ["slack", "github"],
      threadPerIssue: true,
    },
  },

  budget: { perIssueUsd: 15, perEpicUsd: 120 },
});
```

Three things worth noticing. `merge: "auto"` is **not a value the type accepts** — the safety
property is in the type system, not in a doc. `dispatcher` keyed by phase is where vendor
neutrality stops being a slogan: switching who reviews is one line. And every field here answers
a question the environment *can't* — which is the test for whether a knob belongs at all.

---

## Level 3 — customize the process

The process files are the process. No config change needed — edit the file.

```md
<!-- .conductor/process/spec/SKILL.md -->
---
description: Research the issue and write a two-part spec. Part I is the case for a human; Part II is the build plan for the implementing agent.
argument-hint: <issue-id>

agents:
  researcher:
    prompt: |
      You research implementation approaches. Read the codebase before proposing
      anything. Cite the files you read. If two approaches are viable, present
      both with the tradeoff named — do not pick silently.
    tools: [read, grep, glob, webSearch]
  author:
    prompt: |
      You write the spec. Lead with plain language (a reader should grok the
      problem before any density). Name the 1–5 tenets this change turns on.
    tools: [read, write]
    visibility: primary

allowed-tools: [read, grep, glob, webSearch, write]
---

Research the issue, then write the spec to `docs/specs/<ISSUE-ID>.md` and open it as a PR
marked ready for review.

Reviewer contract for the PR description: this is a DIRECTION check, not a design review.
Challenge the approach. Naming, file layout, and local structure are the implementer's.
```

**This phase writes to a branch, so something has to own the worktree.** The split
(`conductor.md` §6, "Who owns the git worktree"): **conductor owns branch policy** — the name,
and basing on freshly-fetched `origin/main` via `checkout -B`, never `git checkout main`, because
the shared ref can be checked out in one worktree at a time and parallel phases race on it.
**The dispatcher owns workspace isolation and declares its model**, because the answer really
does differ per vendor:

```ts
dispatcher: {
  // Local CLI: runs in a cwd, so conductor provisions .conductor/worktrees/<issue>.
  default: claudeCodeDispatcher({ isolation: "worktree" }),
  // Cloud dispatch: the vendor supplies isolation. Conductor hands over a branch
  // name and manages no local tree at all.
  implement: claudeCodeDispatcher({ mode: "cloud", isolation: "remote" }),
}
```

Worktrees stay in conductor's dispatcher layer and do **not** become an FSD concern — they're
development-orchestration knowledge, not infrastructure every FSD app needs (tenet 4).

This is deliberately the **same `SKILL.md` shape the framework already runs** — the skills
runtime, `agents:` delegation, `allowed-tools`. Conductor ships a template of these; a project
edits them; nothing about the mechanism is conductor-specific. That is the whole reason the
process is customizable without a plugin API.

Guidance is the same idea, one directory over:

```md
<!-- .conductor/guidance/objectives/q3-reliability.md -->
---
kind: objective
label: Cut p99 latency on the read path
---

Reads above 400ms are the top support driver this quarter. Work that reduces read latency
outranks work that adds surface. If a spec adds a synchronous hop to the read path, that is a
direction problem, not a detail.
```

Dropping that file in fires `guidance_changed` — and so does editing it in your editor, or the
vendor harness rewriting it mid-phase. Edits that don't go through conductor are caught by the
**reconciler**, which hashes the guidance files each tick against what it last observed; an
out-of-band edit is the same class of event as a missed webhook (`conductor.md` §10/D1). That is
what makes the next section work regardless of who made the change.

---

## Level 4 — extend

Three seams, in increasing order of how much you're taking on.

### 4a. Your own block, used as a phase worker

A block is a block — conductor's phases are ordinary FSD blocks, so yours composes the same
way. Nothing here is a conductor API.

```ts
// .conductor/blocks/security-review.ts
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { conductorContext } from "@flow-state-dev/conductor/blocks";
import { z } from "zod";

const findings = z.object({
  findings: z.array(z.object({
    severity: z.enum(["high", "medium", "low"]),
    file: z.string(),
    summary: z.string(),
  })),
});

/** Audits the diff for the classes of bug our own review keeps missing. */
const audit = generator({
  name: "security-audit",
  model: "openai/gpt-5.4-mini",
  outputSchema: findings,
  // A built-in capability: injects the entity under management (issue, artifact,
  // PR handles) plus the guidance documents, so the block doesn't re-fetch them.
  uses: [conductorContext({ include: ["diff", "guidance"] })],
  prompt: "Audit this diff. Report only defects you can point at a line for.",
});

/** Posts findings as review comments; returns them so the phase can gate on severity. */
const post = handler({
  name: "post-security-findings",
  inputSchema: findings,
  outputSchema: findings,
  execute: async (input, ctx) => {
    for (const f of input.findings) {
      await ctx.conductor.github.comment({ path: f.file, body: f.summary });
    }
    return input;
  },
});

export const securityReview = sequencer({ name: "security-review" }).step(audit).step(post);
```

### 4b. Your own phase, wired into the state machine

A phase declares where it sits, what advances it, and what it dispatches. The `decide` reducer
stays closed — you add transitions declaratively rather than patching a switch.

```ts
// .conductor/phases/security.ts
import { definePhase } from "@flow-state-dev/conductor";
import { securityReview } from "../blocks/security-review";

export const securityPhase = definePhase({
  name: "SECURITY",
  entity: "issue",

  // Slot it into the default process without redefining the process.
  after: "IMPLEMENTATION",
  before: "RETROSPECTIVE",

  // Skip it where it doesn't apply — same routing key the built-ins use.
  appliesWhen: ({ issue }) => issue.type !== "Spike",

  worker: securityReview,

  // What this phase waits on, and what releases it. A gate is derived, never a
  // parked run — conductor re-reads it every tick.
  //
  // `reads` is what keeps `decide` pure (conductor.md §5): a gate declares the
  // facts it needs, the tick fetches them during read-world, and `satisfiedBy`
  // is an ordinary predicate over the resulting snapshot. A gate can't reach
  // out to GitHub itself, and can't gate on a fact it didn't declare.
  gate: {
    name: "awaiting_security_signoff",
    reads: ["artifact.reviews"],
    satisfiedBy: ({ artifact }) =>
      artifact.reviews.every((r) => r.findings.every((f) => f.severity !== "high")),
  },

  // Signals this phase reacts to, beyond the built-in set.
  on: {
    ci_concluded: "rerun",       // a new commit re-runs the audit
    merge_conflict: "hold",
  },
});
```

```ts
// conductor.config.ts (addition)
import { securityPhase } from "./.conductor/phases/security";

export default defineConductor({
  // …
  phases: [securityPhase],   // appended to the defaults, not replacing them
});
```

### 4c. Your own signal and reaction

The interesting extension point, and the one the guidance model unlocked. Reactions are
`reactTo` on a resource collection — a framework primitive that already ships (FIX-751,
FIX-843), so this is wiring, not new machinery.

```ts
// conductor.config.ts (addition)
import { defineConductor, onGuidanceChange, onSignal } from "@flow-state-dev/conductor";
import { reExamineOpenPrs } from "@flow-state-dev/conductor/blocks";

export default defineConductor({
  // …
  reactions: [
    // A new objective lands → sweep every open PR and report which ones it
    // changes the approach for. This is the worked example from conductor.md §4.
    onGuidanceChange({
      kind: "objective",
      run: reExamineOpenPrs({ report: "comment" }),
    }),

    // Your own signal, emitted by your own block, handled declaratively.
    onSignal("security_findings_high", {
      run: async ({ issue, conductor }) => {
        await conductor.linear?.label(issue.id, "security-hold");
        await conductor.notify(`${issue.id} has high-severity findings`);
      },
    }),
  ],
});
```

---

## What conductor ships versus what you write

| | Ships built in | You write |
|---|---|---|
| **Driver** | `decide(entity, signal, world)`, `reconcile(observed, fresh)` | nothing — it's closed; you extend it with `definePhase` |
| **Phases** | `SPEC`, `IMPLEMENTATION`, `RETROSPECTIVE`; epic `FRAMING`, `CROSS_SPEC_REVIEW`, `WRAP` | extra phases, slotted with `after` / `before` |
| **Process files** | a template of `SKILL.md` per phase | your edits to them (level 3) |
| **Blocks** | `conductorContext`, `reExamineOpenPrs`, GitHub PR ops, gate readers | your own, as ordinary FSD blocks |
| **Dispatchers** | `claudeCodeDispatcher`, `codexDispatcher` | a dispatcher for any other agent — one interface |
| **Connectors** | `githubConnector` (required), `linearConnector` (optional) | another connector if you need one — a v2 question |
| **Signals** | the world set + `guidance_changed` + synthesized ones | your own, emitted by your blocks |
| **Surfaces** | CLI board, devtool module, chat threads | nothing |

---

## The shape claim, stated plainly

Everything above is **four kinds of file**: one config object, a directory of markdown, some
ordinary FSD blocks, and declarative phase/reaction entries. There is no plugin system, no
lifecycle-hook registry, and no conductor-specific DSL beyond `definePhase` and the reaction
helpers — because the extension mechanisms are the framework's own (blocks, capabilities,
resource collections, `reactTo`, skills).

That is the test this sketch exists to pass. If extending conductor required learning a second
programming model on top of FSD, the design would be wrong regardless of how the diagrams look.

**Least settled parts, so they get scrutiny rather than acceptance:**

1. **`definePhase`'s `after` / `before` slotting.** Ordering by neighbour is readable but gets
   ambiguous with several inserted phases. A declared sequence might be more honest.
2. **`ctx.conductor.*`** (`github`, `linear`, `notify`). Convenient, and exactly the kind of
   ambient god-object that ages badly. Capabilities are probably the right shape instead —
   and this needs settling before M1 writes a phase block against it (`conductor.md` §12,
   open question 7).
3. **Whether `phases` should append or replace.** Appending is friendlier; replacing is more
   predictable. Currently appending, which makes the default process partly implicit.

**Settled since the first draft:** `gate.satisfiedBy` was listed here as a pure predicate that
real gates would force into an I/O surface. It doesn't: a gate declares its facts via `reads`
and the tick materializes them before `decide` runs, so the predicate stays pure by
construction (`conductor.md` §5, "Gates are predicates over a snapshot"). That is a
precondition for M0 rather than a later refinement.
