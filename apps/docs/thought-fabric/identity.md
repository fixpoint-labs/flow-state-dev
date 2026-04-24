---
sidebar_position: 4
---

# Identity

The identity domain (`@thought-fabric/core/identity`) defines how an agent sees the world. A **perspective** encodes a viewpoint — what to pay attention to, how to reason, what expertise to draw on. Two agents looking at the same code review will notice different things if one has a security perspective and the other has a performance perspective.

Perspectives aren't static prompt templates. They accumulate **observations** (things noticed during analysis) and **positions** (conclusions reached from evidence). Over the course of a session, a perspective develops an evolving understanding that feeds back into subsequent analyses.

The domain currently ships `perspective`. A second primitive, `constitution` (values and behavioral constraints), is planned.

## Quick Start

The fastest way to add perspective is `system()`. It creates a bundled set of blocks, a capability, and a capture pipeline:

```ts
import { perspective, system } from '@thought-fabric/core/identity'
import { generator, sequencer } from '@flow-state-dev/core'

const securityEngineer = perspective({
  name: 'security-engineer',
  description: 'Security engineer focused on auth, input validation, and data exposure',
  salience: {
    amplify: ['authentication', 'authorization', 'input validation', 'data exposure'],
    suppress: ['code style', 'naming conventions'],
  },
  reasoning: {
    priorities: ['identify attack vectors', 'assess blast radius', 'check for defense in depth'],
    riskModel: 'Assume motivated attackers with knowledge of the system',
  },
  expertise: ['OWASP Top 10', 'threat modeling', 'secure coding patterns'],
  communicationStyle: {
    tone: 'direct and specific',
    emphasis: 'risks before mitigations',
    evidencePreference: 'concrete examples of past incidents',
  },
})

const sec = system(securityEngineer, { model: 'preset/fast' })
```

Wire the capability into a generator and add capture to your pipeline:

```ts
const chat = generator({
  name: 'chat',
  model: 'preset/fast',
  uses: [sec.capability],
  user: (input) => input.message,
})

const pipeline = sequencer({ name: 'review', inputSchema })
  .then(chat)
  .work(
    (response) => ({ content: response }),
    sec.capture,
  )
```

`sec.capture` runs in the background via `.work()`. It analyzes the response through the perspective's lens and records observations. On the next turn, those observations appear in the generator's context automatically — the perspective remembers what it noticed.

## Defining a Perspective

The `perspective()` factory validates your config and returns a frozen instance:

```ts
const reviewer = perspective({
  name: 'code-reviewer',
  description: 'Senior engineer reviewing for correctness, maintainability, and performance',
  salience: {
    amplify: ['correctness', 'error handling', 'performance bottlenecks', 'API contracts'],
    suppress: ['formatting', 'import order'],
  },
  reasoning: {
    priorities: ['verify correctness first', 'then maintainability', 'then performance'],
    riskModel: 'Code ships to production and runs for years',
    successCriteria: 'Every concern is actionable with a specific suggestion',
  },
  expertise: ['distributed systems', 'TypeScript', 'testing strategies'],
  communicationStyle: {
    tone: 'constructive and specific',
    emphasis: 'what to change and why',
  },
})
```

**Config fields:**

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Kebab-case identifier used in block names and logging |
| `description` | Yes | One-line role description the LLM sees as framing |
| `salience.amplify` | Yes | Concerns this perspective foregrounds |
| `salience.suppress` | No | Concerns this perspective de-emphasizes (default: `[]`) |
| `reasoning.priorities` | Yes | Ordered analytical priorities |
| `reasoning.riskModel` | No | How this perspective models risk |
| `reasoning.successCriteria` | No | What "done well" looks like |
| `expertise` | No | Domain knowledge areas (default: `[]`) |
| `communicationStyle` | No | Tone, emphasis, and evidence preferences |

The returned instance is deeply frozen. Pass it to block factories or `system()`.

## How Perspectives Evolve

A fresh perspective starts with only its static framing — role, salience, reasoning, expertise. As the agent processes content, two things accumulate:

**Observations** are things the perspective noticed. Each has a `content` string, a `category` (concern, insight, question, pattern, anomaly), and a `confidence` score. Observations are always session-scoped — they belong to the conversation they emerged from.

**Positions** are conclusions the perspective has reached. Each has a `claim`, `reasoning`, `confidence`, and links to the observations that support it. Positions can be **challenged** with counter-evidence, which lowers confidence. Position scope is configurable: session (default), user (persists across sessions), or project (shared across users).

On each turn, the perspective's accumulated observations and positions are formatted and injected into the generator's context. The agent sees what it has noticed so far and what conclusions it has drawn. This produces genuine continuity — the perspective's analysis at turn 10 is informed by everything it noticed in turns 1 through 9.

## The System Bundle

`system()` is the primary API. It returns everything you need:

```ts
const sec = system(securityEngineer, {
  positionScope: 'user',  // positions persist across sessions
  model: 'preset/fast',
})
```

**What you get back:**

| Property | Type | Purpose |
|----------|------|---------|
| `sec.apply` | Handler | Inject perspective framing into content |
| `sec.analyze` | Generator | LLM analysis through the perspective's lens |
| `sec.auditor` | Sequencer | apply → analyze pipeline |
| `sec.observe` | Handler | Record observations from analysis output |
| `sec.position` | Handler | Record a position from accumulated evidence |
| `sec.challenge` | Handler | Challenge a position with counter-evidence |
| `sec.snapshot` | Handler | Read current observations + positions |
| `sec.advance` | Handler | Bump the observation turn counter |
| `sec.capture` | Sequencer | analyze → observe (the "sticky" pipeline) |
| `sec.capability` | Capability | For `uses: [sec.capability]` on blocks |
| `sec.recall(ctx)` | Function | Read accumulated state from runtime context |
| `sec.contextFormatter` | Context fn | For generator `context: [...]` arrays |
| `sec.sessionResources` | Object | Spread into `defineFlow`'s `session.resources` |
| `sec.userResources` | Object | Spread into `defineFlow`'s `user.resources` |
| `sec.projectResources` | Object | Spread into `defineFlow`'s `project.resources` |
| `sec.instance` | Object | The original frozen perspective config |

**Config options:**

| Option | Default | Purpose |
|--------|---------|---------|
| `positionScope` | `'session'` | Where positions live: `'session'`, `'user'`, or `'project'` |
| `model` | — | Model ID for the analyze generator |
| `name` | Perspective name | Override the block name prefix |

## Capability Surface

The capability packages everything a block needs. Declare `uses: [sec.capability]` and the framework auto-installs resources and context formatters:

```ts
const chat = generator({
  name: 'chat',
  model: 'preset/fast',
  uses: [sec.capability],
  user: (input) => input,
})
```

Two context presets are enabled by default:

- **`static`** — the perspective's initial framing: role, salience, reasoning, expertise, communication style.
- **`accumulated`** — observations and positions from the resources. Empty until something records them.

Disable either when token budget is tight:

```ts
// Skip accumulated context (static framing only)
const lightChat = generator({
  name: 'light-chat',
  uses: [sec.capability.presets({ accumulated: false })],
  // ...
})

// Skip all perspective context (just use the helpers)
const bare = handler({
  name: 'bare',
  uses: [sec.capability.presets({ static: false, accumulated: false })],
  execute: async (input, ctx) => {
    // Typed helpers still available
    ctx.cap.perspective.observe({ content: 'Found SQL injection', category: 'concern', confidence: 0.95 })
    const obs = ctx.cap.perspective.observations('concern')
  },
})
```

### Capability helpers

Inside a block that declares `uses: [sec.capability]`, you get `ctx.cap.perspective.*`:

| Helper | Purpose |
|--------|---------|
| `observe(input)` | Record an observation |
| `forget(id)` | Remove an observation by ID |
| `observations(category?)` | Read observations, optionally filtered |
| `advance()` | Bump the turn counter |
| `position(input)` | Record a position |
| `challenge(id, evidence)` | Add counter-evidence to a position |
| `forgetPosition(id)` | Remove a position by ID |
| `positions()` | Read all positions |
| `instance()` | Access the frozen perspective config |
| `format()` | Formatted string of observations + positions |

## The Capture Pipeline

`sec.capture` is a sequencer: **analyze → observe**. It takes `{ content: string }`, runs an LLM analysis through the perspective's lens, and records the resulting observations.

```ts
const pipeline = sequencer({ name: 'review', inputSchema })
  .then(chatGenerator)
  .work(
    (response) => ({ content: response }),
    sec.capture,
  )
```

The analyze step produces a `PerspectiveAnalysis`:

```ts
{
  perspectiveName: string    // Which perspective produced this
  analysis: string           // The analytical findings
  salienceNotes: string[]    // What the salience model highlighted
  recommendations: string[]  // Actionable recommendations
  confidence: number         // 0–1 overall confidence
}
```

The observe step extracts `salienceNotes` and records each as an observation. These observations then appear in the perspective's `accumulated` context on the next turn.

Position the capture after your generator so it sees the response. Run it as `.work()` (background) so it doesn't block the pipeline.

## Individual Blocks

Every block from `system()` is also exported individually for custom pipelines:

### Static blocks (Phase A)

| Block | Kind | Purpose |
|-------|------|---------|
| `perspectiveApply(config)` | Handler | Inject perspective framing into content |
| `perspectiveAnalyze(config)` | Generator | LLM analysis through the perspective |
| `perspectiveAuditor(config)` | Sequencer | apply → analyze |

```ts
import { perspectiveAnalyze } from '@thought-fabric/core/identity'

const analyze = perspectiveAnalyze({
  name: 'sec-analyze',
  perspective: securityEngineer,
  model: 'preset/fast',
})
```

### Stateful blocks (Phase B)

| Block | Kind | Purpose |
|-------|------|---------|
| `perspectiveObserve(config)` | Handler | Record observations from analysis or explicit batch |
| `perspectivePosition(config)` | Handler | Record a position with supporting observations |
| `perspectiveChallenge(config)` | Handler | Challenge a position with counter-evidence |
| `perspectiveSnapshot(config)` | Handler | Read current observations + positions |
| `perspectiveAdvance(config)` | Handler | Bump observation turn counter |

Stateful blocks declare their own resources. When used with `system()`, they share resource refs so all blocks in the bundle operate on the same state.

```ts
import { perspectiveObserve, perspectiveAnalyze } from '@thought-fabric/core/identity'

// Manual capture pipeline — same as sec.capture but assembled by hand
const analyze = perspectiveAnalyze({ perspective: securityEngineer, model: 'preset/fast' })
const observe = perspectiveObserve({ perspective: securityEngineer })

const pipeline = sequencer({ name: 'manual-capture' })
  .then(analyze)
  .tap(observe)
```

## Position Scope

Observations are always session-scoped — they're tied to the conversation they emerged from. Positions can live in different scopes:

| Scope | Persistence | Use case |
|-------|-------------|----------|
| `'session'` (default) | Resets each session | Conclusions about this conversation |
| `'user'` | Persists across sessions | Long-term analytical positions for a user |
| `'project'` | Shared across users | Team-level positions about a codebase |

```ts
const sec = system(securityEngineer, { positionScope: 'user' })

// Resources end up in the right scope
defineFlow({
  session: { resources: sec.sessionResources },
  user: { resources: sec.userResources },
})
```

## Resource Helpers

For direct resource manipulation outside blocks:

### Observations

| Helper | Purpose |
|--------|---------|
| `addPerspectiveObservation(ref, input)` | Add an observation |
| `removePerspectiveObservation(ref, id)` | Remove by ID |
| `perspectiveObservations(ref, category?)` | Read observations, optionally filtered |
| `advancePerspectiveObservations(ref)` | Bump turn counter |
| `formatPerspectiveObservations(ref)` | Format for LLM context |

### Positions

| Helper | Purpose |
|--------|---------|
| `addPerspectivePosition(ref, input, obsRef?)` | Add a position |
| `challengePerspectivePosition(ref, id, evidence, obsRef?)` | Add counter-evidence |
| `removePerspectivePosition(ref, id)` | Remove by ID |
| `perspectivePositions(ref)` | Read all positions |
| `formatPerspectivePositions(ref)` | Format for LLM context |

### Combined

| Helper | Purpose |
|--------|---------|
| `formatPerspectiveAccumulated(obsRef, posRef?)` | Format both observations + positions |

## Static Formatting

For one-shot use without resources (the Phase A surface):

```ts
import { formatPerspective, summarizePerspective } from '@thought-fabric/core/identity'

// Full formatted perspective for LLM context
const context = formatPerspective(securityEngineer)

// One-line summary
const summary = summarizePerspective(securityEngineer)
```

`perspectiveContextFormatter` is a ready-made context slot function:

```ts
import { perspectiveContextFormatter } from '@thought-fabric/core/identity'

const chat = generator({
  context: [perspectiveContextFormatter(securityEngineer)],
  // ...
})
```

## Multi-Perspective Flows

Different perspectives can coexist in the same flow. Each `system()` call produces independent resources and blocks:

```ts
const sec = system(securityEngineer, { model: 'preset/fast' })
const perf = system(performanceEngineer, { model: 'preset/fast' })

defineFlow({
  session: {
    resources: { ...sec.sessionResources, ...perf.sessionResources },
  },
})
```

Use separate capabilities on different generators, or compose analyses:

```ts
const secReview = generator({ uses: [sec.capability], /* ... */ })
const perfReview = generator({ uses: [perf.capability], /* ... */ })
```

## Naming Convention

Word order encodes the category, following the same pattern as memory:

| Pattern | Category | Example |
|---------|----------|---------|
| `perspective[Verb]` | Block | `perspectiveApply`, `perspectiveAnalyze`, `perspectiveObserve` |
| `[verb]Perspective[Noun]` | Helper | `addPerspectiveObservation`, `formatPerspectivePositions` |

## Further Reading

- [API Reference](/thought-fabric/api) — Full export list
- [Memory](/thought-fabric/memory) — Memory domain (similar resource + capability patterns)
- [Metacognition](/thought-fabric/metacognition) — Bias detection (works well as a companion to perspective)
- [Introduction](/thought-fabric/introduction) — Thought Fabric overview
