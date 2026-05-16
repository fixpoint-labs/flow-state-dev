# Naming Conventions

`@thought-fabric/core` uses a word-order convention to encode what kind of export something is. This applies to all domains (memory, attention, identity, etc.) and all patterns within those domains.

## The Rule

**Prefix first = an item.** Blocks, resources, schemas, formatters, and accessors lead with the pattern name.

**Verb first = a helper.** Functions that operate directly on a resource ref lead with the action verb.

```
workingMemoryCapture    → block factory (compose in a pipeline)
addWorkingMemory        → helper function (call on a resource ref)
```

The English reads naturally either way. "The working memory capture block" vs "add to working memory." No docs needed to understand the distinction — the code just reads correctly.

## Naming Table

| Category | Pattern | Examples |
|----------|---------|---------|
| Block factory | `[pattern][Verb]` | `workingMemoryCapture`, `workingMemoryTick`, `workingMemoryAdd` |
| Resource | `[pattern]Resource` | `workingMemoryResource` |
| Pre-keyed resources | `[pattern]Resources` (plural) | `workingMemoryResources` |
| Schema | `[pattern][Noun]Schema` | `workingMemoryEntrySchema`, `workingMemoryObservationsSchema` |
| Formatter | `[pattern][Noun]Formatter` | `workingMemoryContextFormatter` |
| Accessor | `[pattern][Noun]` | `workingMemoryItems` |
| Config constant | `DEFAULT_[PATTERN]_CONFIG` | `DEFAULT_WORKING_MEMORY_CONFIG` |
| Helper | `[verb][Pattern]` | `addWorkingMemory`, `evictWorkingMemory`, `advanceWorkingMemory` |
| Helper (format) | `format[Pattern][Noun]` | `formatWorkingMemoryEntries` |
| Pure math | no prefix | `computeDecay`, `computeSalience` |

## Why Inversion?

The word order makes a real distinction:

- `workingMemoryAdd` is a handler block. It has an input schema, runs in a pipeline, participates in sequencer composition. It's a **thing**.
- `addWorkingMemory` is a function. It takes a resource ref, mutates state, returns a result. It's an **action**.

These are fundamentally different. The block is declarative (you compose it). The helper is imperative (you call it). Making them look different in code prevents confusion about which one you're holding.

## Subpath Exports

Each domain gets one subpath: `@thought-fabric/core/attention`, `@thought-fabric/core/identity`, etc.

- Named exports only. No default namespace objects. This keeps imports tree-shakeable.
- The root `@thought-fabric/core` re-exports all domains as namespace objects (`attention.*`, `identity.*`) for convenience.
- Both paths use the same qualified names. There is exactly one name for each export.

```ts
// These resolve to the same symbol:
import { filterRelevance } from '@thought-fabric/core/attention'
import { attention } from '@thought-fabric/core'
attention.filterRelevance  // same function
```

## Pre-keyed Resources

Each pattern exports a plural `[pattern]Resources` object that maps the correct resource key. This avoids consumers hard-coding a key name that's really an internal contract between the blocks and the resource.

```ts
// workingMemoryResources = { workingMemory: workingMemoryResource } as const

// Simple — just working memory
sessionResources: workingMemoryResources

// Compose multiple pattern resources
sessionResources: {
  ...workingMemoryResources,
  ...episodicMemoryResources,
}

// Mix with custom resources
sessionResources: {
  ...workingMemoryResources,
  userPrefs: userPrefsResource,
}
```

The singular `workingMemoryResource` still exists for cases where you need the raw resource definition (e.g., passing to `defineResource` utilities or inspecting the schema). But `workingMemoryResources` (plural) is the preferred way to declare resources on blocks and generators.

## Context Formatters

Formatters designed for a generator's `context` field follow `[pattern]ContextFormatter` naming.

Always assign context as an **array** to communicate that multiple formatters can be composed:

```ts
// Good — array form, communicates composability
context: [workingMemoryContextFormatter]

// Good — multiple formatters
context: [workingMemoryContextFormatter, identityContextFormatter]
```

## Applying to New Patterns

When adding a new pattern (e.g., episodic memory):

1. Block factories: `episodicMemory[Verb]` (e.g., `episodicMemoryStore`, `episodicMemoryRecall`)
2. Resource: `episodicMemoryResource`
3. Pre-keyed resources: `episodicMemoryResources` (e.g., `{ episodicStore: ..., episodicIndex: ... }`)
4. Schemas: `episodicMemory[Noun]Schema`
5. Helpers: `[verb]EpisodicMemory` (e.g., `addEpisodicMemory`, `queryEpisodicMemory`)
6. Context formatter: `episodicMemoryContextFormatter`

The qualified names prevent collisions at the `memory.*` barrel level. `addWorkingMemory` and `addEpisodicMemory` coexist without ambiguity. Pre-keyed resources compose cleanly:

```ts
sessionResources: {
  ...workingMemoryResources,
  ...episodicMemoryResources,
}
```
