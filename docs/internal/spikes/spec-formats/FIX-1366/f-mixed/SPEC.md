# FIX-1366 · Teach the built-in worker kind

Docs only · 0 new pages · 1 PR · epic FIX-1359
[Decisions](DECISIONS.md) · [Business rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

## Three readers, before and after

| A reader who… | Today | After |
|---|---|---|
| **wants a worker and has written no code** | Opens Overview. First example says: write a `kinds` map. Never learns there's a built-in | Opens Overview. First example is a worker file and a hire call with no `kinds`. One line says: this is the built-in, it has no memory, here's the full reference |
| **needs their worker to call their own tools** | Finds the built-in section by luck, two-thirds down the file-format page. It lists 3 settings. The API has 9 | Follows the anchor. Finds all 9, registers a configured flow under `agent`, learns it replaces the default for every seat |
| **needs something the built-in isn't** | Sees the example kind `worker-agent` beside the real id `agent`. Can't tell which one ships | Reads what the built-in doesn't do, then meets `custom-agent`, which reads as what it is: an example |

A fourth reader, on the public Atlas, sees `defineAgent` called an "invent-kill candidate". It was removed.

## The front door

![Two wireframes: today the overview leads with a kinds map and the built-in is taught unlinked two-thirds down another page; after, the overview leads with the zero-code hire and anchors into the same section, grown](figures/front-door.svg)

The content already exists and is good. What moves is *where a reader meets it*: the first example on the front door, with a link into the section that already holds the answer. The sidebar doesn't change, which is the trade in [D1](DECISIONS.md#d1).

## The reference

![Nine options in a grid: today three are documented and six missing; after, all nine, with the three classifier cells marked documented but not promoted](figures/coverage.svg)

Today the page says "3 settings plus a switch". The API has 5 app options and 4 worker settings. After, all nine are on the page, and the three classifier-related ones are documented without being promoted: the classifier is opt-in and off by default ([D2](DECISIONS.md#d2)).

## The reference, as a diff

```diff
  # workers-on-disk.md → "The worker you get without writing one"     (heading unchanged: it's the anchor)
- its settings are instructions, model, and tools — plus a switch
+ app supplies:    catalog · skills · model · classifierModel · confidenceThreshold
+ worker declares: instructions · model · tools · skills.enableLlmClassifier (off by default)
+ the last two app options are app-level because the matcher is built once per kind
+ tools: is a hard fence — a seat calls exactly what it names.
+ known limit: capability-contributed tools are unioned on today, not intersected.
  zero-code example · no-memory line · factory replacement · empty-catalog note   (unchanged)
```

## What stays as it is

- The built-in section's existing prose. It grows. It doesn't move, copy, or re-voice.
- Pages documenting `agentRegistry` / `materializeAgent` as bring-your-own options. They're correct.
- The contract's C6 text, which deliberately keeps `worker-agent` as the record of the split.
- The source docstring fix. Already on `main` as FIX-1392.
- Core tool resolution (FIX-1393) · memory composition (FIX-1364) · skills entry points (FIX-1362) · `createChannelFlow` (FIX-1386) · the three sibling atlas pages (FIX-1387).

## Sign off

1. **[D1](DECISIONS.md#d1) · No new page. Grow the section, promote by anchor.** If wrong: it stays hard to find, and one sidebar label fixes it.
2. **[D2](DECISIONS.md#d2) · The reference lists all 9 options, emphasis unchanged.** If wrong: we've published knobs we'd rather not have, and narrowing reads as a removal.
3. **[D3](DECISIONS.md#d3) · Atlas: `workforce.html` only, 3 classes of false claim.** If wrong: three public pages keep asserting a removed API a while longer.

**Open, recommend yes:** anchor-link only, no sidebar entry. What would change my mind: a design partner onboarding from the sidebar alone. Full reasoning in [DECISIONS.md](DECISIONS.md); what the pages must and must not say in [BUSINESS-RULES.md](BUSINESS-RULES.md).
