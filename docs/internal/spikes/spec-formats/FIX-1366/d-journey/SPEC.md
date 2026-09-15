# FIX-1366 · Teach the built-in worker kind

Docs only · 0 new pages · 1 PR · epic FIX-1359 · [plan](PLAN.md)

## Three readers, before and after

| A reader who… | Today | After |
|---|---|---|
| **wants a worker and has written no code** | Opens Overview. First example says: write a `kinds` map. Never learns there's a built-in | Opens Overview. First example is a worker file and a hire call with no `kinds`. One line says: this is the built-in, it has no memory, here's the full reference |
| **needs their worker to call their own tools** | Finds the built-in section by luck, two-thirds down the file-format page. It lists 3 settings. The API has 9 | Follows the anchor. Finds all 9, registers a configured flow under `agent`, learns it replaces the default for every seat |
| **needs something the built-in isn't** | Sees the example kind `worker-agent` beside the real id `agent`. Can't tell which one ships | Reads what the built-in doesn't do, then meets `custom-agent`, which reads as what it is: an example |

A fourth reader, on the public Atlas, sees `defineAgent` called an "invent-kill candidate". It was removed months ago.

## The front door, as a diff

```diff
  # Workforce → Overview
- first example: a worker file + hireWorkforce({ kinds: { "worker-agent": workerAgentFlow } })
+ first example: a worker file + hireWorkforce({ … })        ← no kinds. This is the built-in.
+ "It has no memory across turns."                            ← same prominence as today
+ → anchor: workers-on-disk.md#the-worker-you-get-without-writing-one
+ then: kinds, as what you pass when you want a kind of your own
- custom kind shown as "worker-agent" / workerAgentFlow
+ custom kind shown as "custom-agent" / customAgentFlow
```

## The reference, as a diff

```diff
  # workers-on-disk.md → "The worker you get without writing one"     (heading unchanged: it's the anchor)
- its settings are instructions, model, and tools — plus a switch
+ app supplies:    catalog · skills · model · classifierModel · confidenceThreshold
+ worker declares: instructions · model · tools · skills.enableLlmClassifier (off by default)
+ the last two are app-level because the matcher is built once per kind
+ tools: is a hard fence — a seat calls exactly what it names.
+ known limit: capability-contributed tools are unioned on today, not intersected.
  zero-code example · no-memory line · factory replacement · empty-catalog note   (unchanged)
```

## Why not…

**…a new `built-in-worker.md`?** This spec's first draft proposed one. Review found the section already existed and was good. A new page relocates teaching, buys one sidebar row, and creates a second copy to keep in step. **Cost of skipping it:** no sidebar entry names the concept. A label fixes that later, once someone actually fails to find it.

**…document only 3 options and stay quiet about the classifier?** A reference that undercounts a public surface sends people to our source. Documenting all 9 makes 3 classifier knobs public surface we can't quietly narrow. Acceptable alternative: list 3 and defer 2 in one explicit line. Not acceptable: an inventory that reads complete and isn't. Either way, the prose must not push people to turn the classifier on.

**…sweep all four atlas pages?** `workforce.html` alone has 59 matching lines. Bounded to 3 classes of false claim, it's a pass. Unbounded, it's a rewrite. The 3 siblings (14 lines) are real and false, and they're FIX-1387's.

**…rename the contract doc here?** `workforce-agent-kind.md` teaches the noun we moved away from. FIX-1363 deferred it to this issue so it lands with the teaching migration. Two inbound refs move with it. Body untouched.

**…fix the source docstring here?** It's already on `main` as FIX-1392. A spec branch never merges, so it couldn't wait here.

## What stays exactly as it is

- The built-in section's existing prose. It grows. It doesn't move, copy, or re-voice.
- Pages documenting `agentRegistry` / `materializeAgent` as bring-your-own options. Correct.
- The contract's C6 text, which deliberately keeps `worker-agent` as the record of the split.
- `workers-on-disk.md:248`, the refusal-list line. FIX-1363's.
- Core tool resolution (FIX-1393) · memory composition (FIX-1364) · skills entry points (FIX-1362) · `createChannelFlow` (FIX-1386).

## Sign off

1. **No new page. Grow the section, promote by anchor.** If wrong: it stays hard to find, and one sidebar label fixes it.
2. **The reference lists all 9 options, emphasis unchanged.** If wrong: we've published knobs we'd rather not have, and narrowing reads as a removal.
3. **Atlas: `workforce.html` only, 3 classes of false claim.** If wrong: three public pages keep asserting a removed API a while longer.

**Open, recommend yes:** anchor-link only, no sidebar entry. What would change my mind: a design partner onboarding from the sidebar alone.

## How this spec changed its mind

Draft said "nothing teaches the built-in" and proposed a page. Round 1 found the page duplicates a section. Round 2 showed the premise was false and reversed the direction to grow and promote. An Architect ruling on epic PR #1730 then settled the `tools:` fence: teach the guarantee, name the hole, no roadmap language.
