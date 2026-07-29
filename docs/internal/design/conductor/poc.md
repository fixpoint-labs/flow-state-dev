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
  docs/
    philosophy.md              # your tenets — ALREADY YOURS. Conductor reads, never owns.
    objectives.md              #   likewise. Claude Code reads these today.
  conductor.config.ts          # level 1–2: the only required file
  .conductor/
    phases/                    # every phase, built-in and yours, in one place
      spec/
        instructions.md        #   level 3: how a spec gets written  (scaffolded on init)
        definition.ts          #   level 4: only present once you eject it
      implement/instructions.md
      review/instructions.md
      retrospective/instructions.md
      security/                #   a phase you added — same shape, no special case
        instructions.md
        definition.ts
    retrospectives/            # conductor's OWN artifacts — one per completed issue/epic
      FIX-967.md
    blocks/                    # level 4: your own blocks
      security-review.ts
```

**Note what is *not* here: a guidance directory.** Philosophy, tenets, and objectives are
app-level facts that matter whether or not conductor is running, and the vendor harness already
reads them. Conductor points at their paths and owns none of it (`conductor.md` §4). The only
documents it owns are **retrospectives** — its own work product — and `distill-lessons` proposes
edits to your guidance from them as an ordinary PR.

**There is no separate "process" directory, because the process *is* the phases.** One
directory, one shape: a phase is a folder with `instructions.md` and optionally a
`definition.ts`. Changing what a phase *says* means editing its instructions; changing what it
*does* means ejecting its definition; adding a phase means adding a folder. Built-in and custom
phases differ only in who wrote them first — customizing and extending are points on one axis,
not two mechanisms in two places.

`.conductor/` is versioned with the repo — the process is part of the codebase, not hidden in
a service, and every change to it shows up in code review.

**Scaffold vs. eject, since the tradeoff is real.** `conductor init` writes `instructions.md`
for each built-in phase, because instructions are what you actually want to edit. It does *not*
write `definition.ts` — the definition is imported from the package until you run
`conductor eject <phase>`, which writes the default block structure into your repo for you to
change. The cost of ejecting is that your copy stops receiving upstream improvements, so it
should be a deliberate act rather than the starting state. Scaffolding every definition on init
would make every project a fork on day one.

**Why files rather than an FSD store:** conductor delegates the work inside a phase to a vendor
harness, and that harness reads *the repo* — not conductor's resources (`conductor.md` §6). Since
guidance already lives in the repo and the harness already reads it, there is nothing to expose:
the phase brief just names the paths relevant to that phase, which is scoping, not plumbing.
Conductor's own bookkeeping — when it last acted on an objective, which retrospectives have been
distilled — stays in an FSD resource keyed by file path, so a human rewriting a doc can't clobber
it.

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
human gates, no auto-merge, the phase instructions from the shipped template.

```bash
pnpm conductor init          # scaffolds .conductor/ (instructions only, no definitions)
pnpm conductor eject spec    # write spec/definition.ts locally to change its structure
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
import { defineConductor, githubConnector, linearConnector } from "@flow-state-dev/conductor";
import { claudeCodeDispatcher, codexDispatcher } from "@flow-state-dev/conductor/dispatchers";

export default defineConductor({
  // `repo`, GitHub auth, and the default branch are still inferred — override only
  // when inference can't be right (a fork targeting upstream, multiple remotes).

  // Guidance is YOURS — conductor reads these paths and owns none of them.
  guidance: ["docs/philosophy.md", "docs/objectives.md"],

  connectors: [
    // GitHub is auto-installed with a discovered token. Name it to override auth,
    // host, or identity — see "authenticating GitHub" below, which is not just
    // plumbing: conductor's own comment-author identity is what lets it ignore
    // its own comments (conductor.md §5).
    githubConnector({
      auth: { appId: process.env.GH_APP_ID!, privateKey: process.env.GH_APP_KEY! },
      baseUrl: "https://ghe.internal/api/v3",   // Enterprise; omitted = github.com
    }),
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

    // A slot takes a dispatcher OR a resolver, the same value-or-function shape
    // `uses` already has. The resolver is PURE over the world snapshot — picking
    // a harness is not a place to start doing I/O (conductor.md §5).
    implement: ({ issue }) =>
      issue.type === "Bug" || issue.size === "small"
        ? claudeCodeDispatcher({ model: "claude-haiku-4-5-20251001" })
        : claudeCodeDispatcher({ mode: "cloud", model: "claude-opus-5" }),

    // A slot also takes an ARRAY — a panel. Each entry runs against the same
    // artifact and produces its own Review, so lenses and vendors can differ.
    review: [
      claudeCodeDispatcher({ model: "claude-opus-5", lens: "correctness" }),
      codexDispatcher({ lens: "security" }),
      claudeCodeDispatcher({ model: "claude-haiku-4-5-20251001", lens: "docs" }),
    ],

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

`merge: "auto"` is **not a value the type accepts** — the safety property lives in the type
system, not in a doc. Every other field answers a question the environment *can't*, which is the
test for whether a knob belongs at all. Three of them are worth expanding.

**A dispatcher slot takes one, a function, or many.** All three are the same slot type, so
nothing new is learned to use the richer forms:

| Form | Use it when |
|---|---|
| `claudeCodeDispatcher({…})` | one harness for the phase, always |
| `({ issue, artifact }) => Dispatcher` | the choice depends on the work — a small bug on a cheap model, a large refactor in the cloud |
| `[a, b, c]` | several agents should run against the same artifact |

The resolver is **pure over the world snapshot**, same rule as gates: picking a harness is not a
place to start doing I/O, or the tick stops being cheap and deterministic. If the choice
genuinely needs judgment ("is this refactor big?"), that is a layer-2 steward decision — it runs
as a dispatched action and returns a signal, it does not run inside the resolver.

**A reviewer panel produces one `Review` per reviewer per round**, which is why §4 says *"one
round against an artifact, by one reviewer."* Three reviewers over two rounds is six `Review`
records and **two** rounds — the convergence budget counts rounds, not reviews, or a panel would
exhaust the budget on its first pass. Findings are aggregated before the revise dispatch, so the
implementing agent gets one consolidated list rather than three conversations.

**GitHub auth is discovered, not assumed.** `GITHUB_TOKEN` / `GH_TOKEN` covers local and Actions,
which is why level 1 needs no connector line. Naming the connector overrides three things
inference can't reach: a **GitHub App** installation (finer scopes, real rate limits), an
**Enterprise base URL**, and **identity**. Identity is the one that isn't just plumbing — §5's
rule that conductor ignores its own comments needs conductor to *have* a stable author identity,
so a GitHub App is the recommended production setup rather than a nicety.

---

## Level 3 — customize the process

The phase instructions are the process. No config change needed — edit the file.

```md
<!-- .conductor/phases/spec/instructions.md -->
---
description: Research the issue and write a two-part spec. Part I is the case for a human; Part II is the build plan for the implementing agent.
argument-hint: <issue-id>
---

Research the issue, then write the spec to `docs/specs/<ISSUE-ID>.md` and open it as a PR
marked ready for review.

Read the codebase before proposing anything, and cite the files you read. If two approaches
are viable, present both with the tradeoff named — do not pick silently. Lead with plain
language: a reader should grok the problem before any density. Name the 1–5 tenets this
change turns on.

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

### Which runtime runs this file

`instructions.md` is a **vendor-neutral instruction payload**, and which runtime consumes it
depends on the layer the phase dispatches to (`conductor.md` §6):

| Dispatched to | Consumed by | `agents:` / `allowed-tools` front-matter |
|---|---|---|
| **Layer 3** — `claudeCodeDispatcher`, `codexDispatcher` | the vendor harness, as its brief. It brings its own skills from `agents/skills/` | ignored — the vendor materializes its own sub-agents |
| **Layer 2** — a steward worker | FSD's skills runtime, or an `Agent` from `workforce` | honored |

The dispatcher declares which it is, so a phase can't silently carry front-matter nothing will
read.

FSD skills are stored as resources and activated when an FSD generator calls `runSkill` — layer
2 only. A phase dispatched to Claude Code never touches that runtime, which is why the file
isn't called `SKILL.md`. **Two skill systems at two layers is the correct shape**; what matters
is saying which one a given phase means.

Either way the process stays **customizable without a plugin API**, because a phase is a
markdown file plus an optional ordinary FSD block.

Guidance is *not* the same idea, and the difference matters: it is **your** document, in your
repo, that conductor happens to read. A heading, not a file:

```md
<!-- docs/objectives.md — yours. Conductor reads it; Claude Code already does. -->
## Cut p99 latency on the read path

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

This is the **same file a built-in phase has**: `conductor eject spec` writes exactly this shape,
so forking a default and writing a new phase are the same edit. The `instructions.md` beside it
is the prompt payload; `definition.ts` is the structure.

```ts
// .conductor/phases/security/definition.ts
import { definePhase } from "@flow-state-dev/conductor";
import { securityReview } from "../../blocks/security-review";

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
import { securityPhase } from "./.conductor/phases/security/definition";

export default defineConductor({
  // …
  phases: [securityPhase],   // appended to the defaults, not replacing them
});
```

### 4c. Your own signal and reaction

A reaction binds a signal to a block. Nothing new underneath: signals conductor writes itself
ride `reactTo` (FIX-751/FIX-843, both shipped), and signals from files conductor *doesn't* write
— guidance among them — come from the tick's hash diff (`conductor.md` §6). Either way the
reaction is the same declaration.

```ts
// conductor.config.ts (addition)
import { defineConductor, onGuidanceChange, onSignal } from "@flow-state-dev/conductor";
import { reExamineOpenPrs } from "@flow-state-dev/conductor/blocks";

export default defineConductor({
  // …
  reactions: [
    // You edit docs/objectives.md → the next tick notices → sweep every open PR
    // and report which ones the new objective changes the approach for. The edit
    // is an ordinary commit to your own doc; conductor just notices.
    onGuidanceChange({
      path: "docs/objectives.md",
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
| **Phases** (files) | `instructions.md` scaffolded per built-in phase; `definition.ts` imported until ejected | your edits to the instructions (level 3), ejected definitions, whole new phase folders (level 4) |
| **Blocks** | `conductorContext`, `reExamineOpenPrs`, GitHub PR ops, gate readers | your own, as ordinary FSD blocks |
| **Dispatchers** | `claudeCodeDispatcher`, `codexDispatcher` | a dispatcher for any other agent — one interface |
| **Connectors** | `githubConnector` (required), `linearConnector` (optional) | another connector if you need one — a v2 question |
| **Signals** | the world set + `guidance_changed` + synthesized ones (`conductor.md` §5) | your own, emitted by your blocks |
| **Documents** | retrospectives, written by the RETROSPECTIVE phase | philosophy / tenets / objectives — **already yours**, conductor only reads them |
| **Surfaces** | CLI board, devtool module, chat threads | nothing |

---

## The shape claim, stated plainly

Everything above is **four kinds of file**: one config object, directories of markdown, some
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
