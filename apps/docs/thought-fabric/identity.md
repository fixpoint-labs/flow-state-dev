---
sidebar_position: 4
---

# Identity

The identity domain (`@thought-fabric/core/identity`) defines how an agent sees the world and what it stands for.

Two primitives:

- **Perspective** encodes a viewpoint — what to pay attention to, how to reason, what expertise to draw on. Two agents looking at the same code review will notice different things if one has a security perspective and the other has a performance perspective. Perspectives accumulate **observations** and **positions** over the course of a session, developing an evolving understanding that feeds back into subsequent analyses.

- **Constitution** encodes values — ranked principles with conflict resolution. When principles conflict ("be helpful" vs. "be cautious"), the constitution provides a structured resolution strategy. The system can reason about *why* its principles are ordered and articulate tradeoffs explicitly.

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

Static perspective blocks can be composed freely because they close over their own `PerspectiveInstance` and do not declare resources:

```ts
const secAnalyze = perspectiveAnalyze({ perspective: securityEngineer, model: 'preset/fast' })
const perfAnalyze = perspectiveAnalyze({ perspective: performanceEngineer, model: 'preset/fast' })

const review = sequencer({ name: 'multi-perspective-review' })
  .thenAll([secAnalyze, perfAnalyze])
```

Use one resource-backed `system()` capability per block or flow. The helpers are exposed as `ctx.cap.perspective`, and resources are declared under `perspectiveObservations` / `perspectivePositions`, so multiple resource-backed perspective systems would currently collide at the capability/resource namespace. If you need two sticky perspectives, run them in separate flows or keep one sticky and use static blocks for the others.

```ts
const sec = system(securityEngineer, { model: 'preset/fast' })
const chat = generator({ uses: [sec.capability], /* ... */ })
```

## Naming Convention

Word order encodes the category, following the same pattern as memory:

| Pattern | Category | Example |
|---------|----------|---------|
| `perspective[Verb]` | Block | `perspectiveApply`, `perspectiveAnalyze`, `perspectiveObserve` |
| `[verb]Perspective[Noun]` | Helper | `addPerspectiveObservation`, `formatPerspectivePositions` |
| `constitution[Verb]` | Block | `constitutionReview`, `constitutionEnforce`, `constitutionAuditor` |
| `[verb]Constitution[Noun]` | Helper | `rankConstitutionPrinciples`, `formatConstitution` |

---

# Constitution

A constitution defines what an AI system stands for. It's a ranked set of principles with a conflict resolution strategy. When principles compete ("be helpful" vs. "be cautious"), the constitution specifies how to resolve the tension.

Constitutions don't execute on their own. They're configuration objects. You pass them to block factories that evaluate content against the principles and produce compliance verdicts.

## Quick Start

```ts
import {
  constitution,
  constitutionAuditor,
} from '@thought-fabric/core/identity'

const values = constitution({
  name: 'advisor-values',
  principles: [
    { id: 'accuracy', statement: 'Provide accurate information', priority: 1 },
    { id: 'safety', statement: 'Avoid recommending harmful actions', priority: 2 },
    { id: 'helpfulness', statement: 'Be genuinely helpful', priority: 3 },
  ],
  conflictResolution: 'priority',
})

const auditor = constitutionAuditor({
  constitution: values,
  model: 'preset/fast',
})

const result = await auditor.run({
  content: 'Here is my response to the user...',
}, ctx)

// result.compliant → true/false
// result.score → 0.85
// result.violations → [{ principleId: 'safety', severity: 'moderate', ... }]
```

The `constitutionAuditor` is a sequencer: it runs an LLM review step, then a deterministic enforce step. The review evaluates each principle individually. The enforce step computes an aggregate compliance score and renders a pass/fail verdict.

## Defining a Constitution

The `constitution()` factory validates your config and returns a frozen definition:

```ts
const values = constitution({
  name: 'advisor-values',
  principles: [
    {
      id: 'accuracy',
      statement: 'Provide accurate, evidence-based information',
      priority: 1,
      rationale: 'Trust depends on factual correctness',
    },
    {
      id: 'safety',
      statement: 'Avoid recommending harmful actions',
      priority: 2,
      rationale: 'Harm prevention outweighs most helpfulness gains',
    },
    {
      id: 'helpfulness',
      statement: 'Be genuinely helpful to the user',
      priority: 3,
    },
  ],
  conflictResolution: 'priority',
  version: '1.0',
})
```

**Config fields:**

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Identifies this constitution in logs and formatted output |
| `principles` | Yes | At least one principle. Each has `id`, `statement`, `priority`. |
| `principles[].id` | Yes | Unique identifier referenced in overrides and review results |
| `principles[].statement` | Yes | Human-readable principle the LLM evaluates against |
| `principles[].priority` | Yes | Integer rank. Lower number = higher priority. |
| `principles[].rationale` | No | Why this principle matters. Helps the LLM reason about tradeoffs. |
| `principles[].weight` | No | Numeric weight for `weighted` mode. Range [0, 1]. |
| `conflictResolution` | No | `'priority'` (default), `'weighted'`, or `'contextual'` |
| `contextualOverrides` | No | Override rules for `contextual` mode |
| `version` | No | Version string for tracking constitution evolution |

The factory validates:
- All principle IDs are unique
- `weighted` mode requires every principle to have a `weight`
- `contextual` mode requires at least one override, and override principle IDs must reference existing principles

The returned object is deeply frozen. Pass it to block factories.

## Conflict Resolution Modes

When principles compete, the conflict resolution mode determines which one wins.

### Priority (default)

Strict ordering by `priority` number. Priority 1 beats priority 2, always. The compliance score uses inverse-priority weighting: higher-priority principles have more influence on the aggregate score.

```ts
const values = constitution({
  name: 'strict-values',
  principles: [
    { id: 'safety', statement: '...', priority: 1 },
    { id: 'helpfulness', statement: '...', priority: 2 },
  ],
  conflictResolution: 'priority',
})
```

### Weighted

Principles carry numeric weights instead of strict ordering. The compliance score is a weighted average of per-principle scores. Good for cases where principles overlap and no single one dominates.

```ts
const values = constitution({
  name: 'balanced-values',
  principles: [
    { id: 'accuracy', statement: '...', priority: 1, weight: 0.4 },
    { id: 'clarity', statement: '...', priority: 2, weight: 0.35 },
    { id: 'brevity', statement: '...', priority: 3, weight: 0.25 },
  ],
  conflictResolution: 'weighted',
})
```

### Contextual

Rules-based overrides that re-rank principles depending on the situation. Each override specifies a `when` condition, a principle to `promote`, and a principle to `demote`. The override activates when the review context has sufficient keyword overlap with the `when` description (40% threshold).

```ts
const values = constitution({
  name: 'adaptive-values',
  principles: [
    { id: 'accuracy', statement: '...', priority: 1 },
    { id: 'speed', statement: '...', priority: 2 },
    { id: 'safety', statement: '...', priority: 3 },
  ],
  conflictResolution: 'contextual',
  contextualOverrides: [
    {
      when: 'medical or health-related query',
      promote: 'safety',
      demote: 'speed',
      reasoning: 'Health contexts demand caution over response time',
    },
  ],
})
```

## The Auditor Pipeline

`constitutionAuditor` is the primary entry point. It bundles two steps:

```
constitutionReview → constitutionEnforce
   (generator)         (handler)
```

The generator calls an LLM to evaluate content against each principle. The handler is deterministic: it computes the aggregate score and renders compliance.

```ts
import { constitutionAuditor } from '@thought-fabric/core/identity'

const auditor = constitutionAuditor({
  constitution: values,
  model: 'preset/fast',
  complianceThreshold: 0.7,  // default
})
```

**Config options:**

| Option | Default | Purpose |
|--------|---------|---------|
| `name` | `'constitution'` | Block name prefix |
| `constitution` | — | The constitution to audit against (required) |
| `model` | `'preset/fast'` | Model for the LLM review step |
| `complianceThreshold` | `0.7` | Score below which a principle is considered violated |

### Review output

The full `ConstitutionReviewOutput`:

```ts
{
  compliant: boolean,       // Overall pass/fail
  score: number,            // 0-1 aggregate compliance
  principleResults: Array<{
    principleId: string,
    score: number,          // 0-1 per-principle
    satisfied: boolean,
    evidence: string,
    reasoning: string,
  }>,
  violations: Array<{
    principleId: string,
    severity: 'minor' | 'moderate' | 'severe',
    description: string,
    evidence: string,
  }>,
  tradeoffs: Array<{
    promoted: string,       // Principle that was favored
    demoted: string,        // Principle that was sacrificed
    reasoning: string,
  }>,
  reasoning: string,        // Overall assessment
}
```

A review is non-compliant when the aggregate score falls below the threshold OR any violation has `severe` severity.

### Using it in a flow

Run the auditor as a sidechain after your generator:

```ts
import { sequencer, generator } from '@flow-state-dev/core'
import { constitutionAuditor } from '@thought-fabric/core/identity'

const chat = generator({ name: 'chat', model: 'preset/default', prompt: '...' })
const auditor = constitutionAuditor({ constitution: values, model: 'preset/fast' })

const pipeline = sequencer({ name: 'chat-with-audit', inputSchema: chatInput })
  .then(chat)
  .tap(auditor)
```

## Individual Blocks

Every block from the auditor is exported individually for custom pipelines.

### constitutionReview

Generator. LLM-evaluates content against the constitution's principles. Scores each principle, identifies violations and tradeoffs, and provides overall reasoning.

```ts
import { constitutionReview } from '@thought-fabric/core/identity'

const review = constitutionReview({
  constitution: values,
  model: 'preset/fast',
})
```

Input: `{ content: string, context?: string }`
Output: `{ principleResults, violations, tradeoffs, reasoning }`

The optional `context` field is used for contextual conflict resolution. It's also included in the LLM prompt as situational context.

### constitutionEnforce

Handler. Deterministic. Computes the final compliance verdict from the review output. No LLM call.

```ts
import { constitutionEnforce } from '@thought-fabric/core/identity'

const enforce = constitutionEnforce({
  constitution: values,
  complianceThreshold: 0.8,
})
```

Input: review step output.
Output: full `ConstitutionReviewOutput` with compliance verdict.

## Helpers

Pure functions for working with constitutions outside of blocks:

```ts
import {
  rankConstitutionPrinciples,
  computeConstitutionCompliance,
  formatConstitution,
  summarizeConstitutionReview,
} from '@thought-fabric/core/identity'
```

| Function | Purpose |
|----------|---------|
| `rankConstitutionPrinciples(constitution, context?)` | Sort principles by effective priority, applying contextual overrides |
| `computeConstitutionCompliance(results, constitution)` | Aggregate compliance score from per-principle results |
| `formatConstitution(constitution)` | Human-readable string for LLM prompt injection |
| `summarizeConstitutionReview(review)` | One-line summary with violation counts and severity |

`DEFAULT_CONSTITUTION_CONFIG` exposes the default `complianceThreshold` (0.7).

## Further Reading

- [API Reference](/thought-fabric/api) — Full export list
- [Memory](/thought-fabric/memory) — Memory domain (similar resource + capability patterns)
- [Metacognition](/thought-fabric/metacognition) — Bias detection (works well as a companion to perspective)
- [Introduction](/thought-fabric/introduction) — Thought Fabric overview
