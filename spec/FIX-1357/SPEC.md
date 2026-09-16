# FIX-1357 · Kinds + blocks boot scan (file-convention registration)

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Feature · `workforce` + `fsdev` · medium · 1 PR · epic [FIX-1351](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **adds a custom worker kind** | Writes the flow, then has to remember a second place: import it at startup and put it on `hireWorkforce`'s kinds map under exactly the right key. Forget, and every seat naming it fails at boot | Puts the file under `workforce/flows/workers/`. The seat that names it hires |
| **adds a custom channel kind** | The same second place, on a different call — `channelInstances`, not `hireWorkforce` | The same one place, `workforce/flows/channels/` |
| **adds a block a task board assigns by name** | A third place: import it and add it to the board's worker map | Puts the file under `workforce/blocks/` |
| **renames a kind and misses the wiring** | The app boots, then refuses the seat, naming the seat rather than the rename | The same refusal, now naming both kinds. A file that exports the wrong *shape* fails the build |
| **deploys to Vercel or Next** | n/a | Byte for byte as today. Nothing is discovered while the app runs, so a bundled deploy behaves like a local one |
| **already passes a kinds map by hand** | The only way | Still works, untouched, forever |

Everything else about a team is already declared in files — its workers, its channels, its
documents, its skills. Its **code** is the one half still wired by hand at startup, and that
wiring is a third copy of a name that already exists twice: as the file, and inside the flow.
Three copies of one name is three chances to disagree.

## What changes

![A horizontal fence divides build time above from run time below. Above it: the owner-locked folders, fsdev gen walking them, and one generated module of static imports exporting three maps. Below it: hireWorkforce, channelInstances and taskBoard receiving the maps they already take, each marked unchanged, and a struck-out box showing the rejected design in which the framework itself walks the tree at run time.](figures/what-changes.svg)

The fence is the whole design. Discovery happens **above** it, in the toolchain, where walking a
folder is ordinary. Below it — the framework doing the same thing while the app runs — is what
this spec refuses: it works on a Node host and finds nothing on a bundled one
([D1](DECISIONS.md#d1)).

The generator reads the **tree**, not the modules in it ([D3](DECISIONS.md#d3)) — it cannot load
them, since `fsdev` ships as compiled JavaScript on plain Node and an app's files resolve through
the app's own aliases. So it names what a walker can see, and the checks needing a file's *value*
stay where they already are: the app's typecheck, and the refusals the framework throws today.

**What an author writes today:**

```diff
- import { researcher } from "./workforce/flows/workers/researcher";
- import { standup }    from "./workforce/flows/channels/standup";
- import { triage }     from "./workforce/blocks/triage";
-
- const seats    = hireWorkforce(records, { kinds: { researcher } });
- const channels = channelInstances(rooms, { kinds: { standup } });
- const board    = taskBoard({ workers: { triage } });
+ import { kinds, channelKinds, blocks } from "./workforce/workforce.gen";
+
+ const seats    = hireWorkforce(records, { kinds });
+ const channels = channelInstances(rooms, { kinds: channelKinds });
+ const board    = taskBoard({ workers: blocks });
```

**And in the app's build script:**

```diff
- "build": "next build"
+ "build": "fsdev gen && next build"
```

The generated module is ordinary TypeScript with static imports, so every bundler already knows
what to do with it. All three call sites are unchanged: same maps, different author.

## What stays as it is

- **A hand-passed map.** Not deprecated, not second-class. An app that never runs `fsdev gen`
  behaves exactly as it does now ([ER-6](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)).
- **Seats stay documents.** `WORKER.md` is untouched, and `flow:` still only names a kind already
  on the map. This changes who fills the map, not what it means.
- **The framework's run-time behaviour.** No new option, no new call, no new *kind* of failure at
  boot. The refusals catching a kind mismatch, a bad cardinality and an unregistered kind are the
  ones shipped today, doing the job they already do.
- **The Markdown readers.** `readWorkforce`, `readChannelsDirectory`, `readResourcesDirectory`
  and `readSeatSkills` still read the tree at run time. Markdown is data; a kind is code.

## Sign off

1. **[D1](DECISIONS.md#d1) · The scan runs at build time, in `fsdev`; the framework never imports
   a path it discovered.** If wrong: the convention is portable but needs a build step, so an
   author who skips it gets a stale registry — a class of confusion we are choosing over a
   feature that silently does nothing on the host most apps deploy to.
2. **[D2](DECISIONS.md#d2) · The generated module feeds the parameters that already exist; the
   framework gains no registration API.** If wrong: the convention is locked to whatever `fsdev`
   emits, and a future producer has to match that file's shape rather than a declared contract.
3. **[D3](DECISIONS.md#d3) · The generator reads the tree, never the modules in it.** This
   narrows a promise the first draft made: a kind renamed out of step with its file is still
   refused by name, but at startup, by the refusal that exists today, not by the generator. If
   wrong: authors meet that mistake one stage later than they could.

**Timing is decided, not open:** build now, with the kitchen-sink consumer in the same PR. ER-15
requires a non-lab consumer before the lab lands, which also rules out waiting for FIX-1355.
What lost and why: [DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
