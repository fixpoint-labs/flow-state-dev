# FIX-1796 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The vocabulary itself is decided in the epic's [concept](../../epics/FIX-1786/concept/CONCEPT.md#vocabulary)
and not reopened here. These are the three calls the Architect's guidance on the issue said to
put to the owner, priced, and a fourth that review found. The owner answered D1 in review, and
reversed it on 2026-10-07 ([epic D7](../../epics/FIX-1786/DECISIONS.md#d7)).

## The tree

```mermaid
flowchart TD
  I["FIX-1796"] --> D1["D1 · seat goes everywhere: a task board's seat becomes assignee"]
  D1 -.->|"rejected · a reader meets Workforce's old word on the board"| X1["the board keeps seat (D1 as merged)"]
  D1 -.->|"rejected · the engine's routes and the router own it"| X1b["route"]
  I --> D2["D2 · saved names are renamed, stores reset once"]
  D2 -.->|"rejected · kept only for reads D9 removed"| X2["saved names keep their strings"]
  I --> D3["D3 · renamed exports break, no alias"]
  D3 -.->|"rejected · an alias is a retired word in an export"| X3["deprecated aliases for a release"]
  I --> D4["D4 · the discovery domain seats becomes workers"]
  D4 -.->|"rejected · a model would still read seat as a worker"| X4["pin seats as a model-facing name"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · "Seat" goes everywhere: a task board's seat becomes assignee

**The product owner, 2026-10-07**, recorded as an amendment to [epic D7](../../epics/FIX-1786/DECISIONS.md#d7):
"I'm still not sold on seats for task boards. Maybe routes? Similar to router. Any other ideas",
then, offered assignee, lane, route and station, "Ok let's go with assignee". It flips this card
as merged, which kept "seat" on the board ([the card as merged](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1796/DECISIONS.md#d1)).

| | |
|---|---|
| **Instead of** | Only Workforce's seat going, while a task board keeps "seat" for a place on a board (D1 as merged) · or route, lane or station, the other words offered. "Route" is already the engine's HTTP routes and the router block kind |
| **Because** | A reader who learned Workforce's seat as a worker would meet the same word on the board, for example on Shift Manager's task screens, where both meet: the case the merged card named as what would change its mind. A task already says `assignee` for the board entry it picks, so the entry and the pick take one name and one glossary row. "Seat" is then a fully retired word, and the guard needs no board exception. It changes a Layer 1 name, so it binds only through the epic, which records it as [D7](../../epics/FIX-1786/DECISIONS.md#d7) and counts it in its D3 (ER-22) |
| **Locks in** | An assignee is a named entry in a board's `workers` map; a task's `assignee` picks it, and it runs the task inline or hands it off to a dispatch run. The board's types, its docs and the hand-off record's `seat` field take the word, with no alias ([D3](#d3)), under the names [PLAN.md](PLAN.md#pinned-names) pins; nothing reads the old field ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)). `defaultWorker`, "the floor", is the default assignee in prose; whether its `kind: "floor"` and `label: "floor"` values change is the implementer's call. The discovery tool's `seats` domain is Workforce's seat, and is [D4](#d4)'s. The guard keeps no board-seat exception: "seat" counts on every line in scope, a board's included |

![D1, flipped by the epic's D7: a task board's seat becomes assignee, chosen, beside the board keeps seat. Decides it: what a reader meets on a board, one word defined once. Price: the board's names change, the epic's second Layer 1 rename. Flips if one word for a board's entry and a task's pick reads ambiguously in the board's API](figures/d1-seat-becomes-assignee.svg)

It comes down to what a reader meets on a board: one word, defined once, and nothing left of Workforce's seat.

**What would change my mind:** one word for a board's entry and a task's pick reading
ambiguously in the board's own API, for example a `workers` map keyed by assignee beside a
task's `assignee` in one signature. Then the entry gets a word of its own, never "seat" again,
as an epic question.

<a name="d2"></a>
## D2 · Saved names are renamed outright; the in-repo stores are reset once

**The product owner, 2026-10-07**, under [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): stored keys are renamed outright, with no read of
the old keys and no copy step, and the kitchen-sink app's and the DevTeam lab's stores are reset
once when this ships. It flips this card as merged, which kept saved strings so the other
children's upgrade reads would find them ([the card as merged](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1796/DECISIONS.md#d2)).

| | |
|---|---|
| **Instead of** | Keeping the stored strings behind renamed constants, `LEGACY_` for a name only an upgrade reads |
| **Because** | The reads those strings were kept for are gone: D9 withdrew FIX-1788's upgrade step, FIX-1790's copy step and FIX-1793's kept room rows, and nobody outside this repo has a store to keep reading. A kept string is a retired word the guard has to except, and the devtool's storage view keeps showing it |
| **Locks in** | Every stored key, collection pattern, id or saved field name that uses a retired word takes the new word, in the PR that renames the code writing it. Nothing reads the old name, and nothing copies a record. A store written before this release loses those records: the kitchen-sink app and the DevTeam lab reset theirs once. The guard keeps no stored-key exception |

![D2, flipped by the epic's D9: rename saved names outright, chosen, beside saved names keep their strings. Decides it: records saved before, dropped because there are no consumers and the two in-repo stores are reset once. Price: a store written before this release loses its Workforce records. Flips if a consumer appears before the closure](figures/d2-saved-names.svg)

It comes down to who still reads the old names: since D9, nobody.

**What would change my mind:** a consumer outside this repo before the closure run. Then D9's
reversal applies: the product owner decides what upgrade path that consumer needs.

<a name="d3"></a>
## D3 · Renamed exports break outright, with no aliases

| | |
|---|---|
| **Instead of** | Keeping each old export as a deprecated alias for one release |
| **Because** | ER-12 forbids a retired term in any package export at the closure, and every alias is one. Since [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) the epic deprecates nothing first, not even flow instances and owner pins. Pre-1.0, a minor release may break (BP-022), and the last rename, FIX-1748, shipped with no aliases. Every in-repo caller moves in the same PR |
| **Locks in** | An app on the old names edits its imports once, on its first upgrade past this release. There is no rename table and no upgrading page ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)). A custom worker flow with a hand-written schema on the old keys is refused at boot, naming the key it lacks |

![D3: rename outright with no alias, chosen, beside deprecated aliases for a release. Decides it: the epic's ER-12 at the closure. Price: an app on the old names breaks on upgrade. Release type is a tie](figures/d3-no-aliases.svg)

It comes down to ER-12: an alias is a retired word in an export, so the closure fails or waits.

**What would change my mind:** an app outside this repo pinned to these exports and promised a
deprecation window. Then alias for one release, and the closure waits for their removal.

<a name="d4"></a>
## D4 · The discovery domain `seats` becomes `workers`

| | |
|---|---|
| **Instead of** | Keeping `seats` in `MANIFEST_DOMAINS` (`contracts`) as a pinned, model-facing name |
| **Because** | The domain lists Workforce's workers, so it is Workforce's seat, and since [D1](#d1)'s flip "seat" names nothing anywhere. It is the one surface a model reads by name, so a surviving `seats` would teach a model the meaning the sweep removes. D3 rules out an alias |
| **Locks in** | `MANIFEST_DOMAINS`, core's discovery tool and Workforce's `discover:` key say `workers`. A saved prompt, skill or eval that passes `seats` gets the "unknown domain" listing, and a worker file with `discover: [seats]` is refused when it is minted, listing the known domains. **Binds once the epic records it** in its next amendment (amend-5): it is a Layer 1 public name (ER-22) |

![D4: seats becomes workers, chosen, beside pin seats as a model-facing name. Decides it: what a model reads by name. Price: saved prompts that pass seats get the unknown-domain listing. Flips if the epic declines the rename](figures/d4-workers-domain.svg)

It comes down to what a model reads by name: pinned, "seats" keeps a Workforce meaning that only a model sees.

**What would change my mind:** the epic declining the rename at amend-5. Then `seats` is pinned
with that cost named, and it goes to the product owner at the gate, because it keeps a word they
retired ([D1](#d1)).

The `mailboxes` domain is not decided here: FIX-1792 removes it ([its PLAN S9](https://github.com/fixpoint-labs/flow-state-dev/pull/2833)).

## Decided, not asked

- **The list is derived.** Each child names the old exports it leaves ([PLAN.md](PLAN.md#at-implement-time));
  the census on the build commit finds the rest. Nothing a sibling is about to delete is renamed.
- **Scope** is the issue's (package source, published docs, labs, apps) plus package tests,
  READMEs, examples, `docs/architecture/` and the root README: they describe current behaviour,
  and BP-034 already makes a rename reach them. `goals/`, process files and history keep their words.
- **"Kind", "owner pin", "flow instance", "member" and "thread" are retired on Workforce's ground
  only.** The engine keeps its flow `kind`, its flow instances and owner pins until FIX-1798; a
  project's member and a chat thread keep theirs. Ground is a surface, not a folder: Workforce's
  own packages and pages, plus any file that imports Workforce or Shift Manager.
- **"Person" stays guarded, on Workforce's ground.** The owner's standing rule is "user, not
  person", so the permanent guard keeps it, on Workforce's ground only. A person who isn't the
  signed-in user (an author, someone a case goes to) is an exception pinned by file and phrase.
  This answers the architecture review's point 2, which asked to drop "person" from the
  permanent guard.
- **"Target" is not scanned.** It never reached Workforce code; the engine's dispatch target stays.
- **Template and library enter the glossary with FIX-1795**, which builds after the MVP. The
  issue's outcome lists them; the epic's later call moves them ([Q2](../../epics/FIX-1786/DECISIONS.md#q2)).
- **The census becomes a CI guard and replaces `scripts/check-mailbox-rename.mjs`.** That guard
  keeps "channel" off the mailbox's surfaces; once mailboxes are gone it guards a retired thing,
  and it would block the later channels feature.
- **`hireWorkforce` is renamed only if it no longer hires.** Neither word is retired; what it
  returns stops saying seat.
- **Two PRs**: Workforce and its apps, then prose, the glossary and the guard
  ([PLAN.md](PLAN.md#pr-plan)). Since D1 flipped, the task board's renames ride with the first,
  beside the code that uses them; if that PR is too big to review, they go first as their own,
  the implementer's call. Each PR's pages move with its code (ER-25).
- **Glossary entries promise no memory layer a flow doesn't keep** (ER-15, FIX-1364).

## Considered and dropped

| Alternative | Why not |
|---|---|
| A scripted find and replace | "Seat" is a worker in Workforce and an assignee on a board; "person" is sometimes any human. A blind replace writes wrong words |
| One PR | About 600 files across several packages. Code and its pages first, prose and the guard after, review faster apart |
| Sweep `goals/` too | Outside the PRD's scope: about 250 files of test prose and folder names. A follow-up if wanted |
| Keep the CI guard for "channel" | Its subject, the mailbox, is retired, and channels come back as their own feature |

<a name="settled"></a>
## Settled

- **The counts this spec rests on** are re-derived by the census, not counted by hand: on
  `cad4e2780`, 22,058 unswept lines in 527 files; every one of 5,802 tracked files has an area;
  `--control` refuses all eighteen plants ([README](poc/term-census/README.md#what-was-observed)).
- **The channel-kind paths the issue fences don't exist on `main`**: CONFIRMED, no
  `flows/channels/` path is tracked at all, and `CHANNEL.md` appears only in one goal fixture and
  two retained specs. So the guard carries no exception for them: one that strips nothing fails it. Channels were renamed to mailboxes before this epic; today
  `CHANNEL.md` is refused by name, pointing at mailboxes ([EVOLUTION.md](EVOLUTION.md)).

## How it got here

- **Draft** — framed as the epic's last sweep before the closure; a census with exceptions that
  strip tokens, not lines, is the goal check and becomes the CI guard; three PRs.
- **Review round 1** — the product owner answered D1: the board keeps "seat", only Workforce's
  goes, so the board PR dropped out (two PRs) and no epic decision is needed. The census now
  scopes ground and the board's seat by surface, scans "member", "thread" and lower-camel
  `room…` names, strips a stored key without the rest of its literal, and fails on a stale
  exception, so the unused channel-path exception went. Then the architect and the epic's
  coordinator split the discovery domain from the board: `seats` lists workers, so it becomes
  `workers` (D4), and "person" keeps its permanent guard, on Workforce's ground.
- **Review round 2** — the board's surface is defined by module, like Workforce's ground, not by
  a closed file list that left about 125 of the board's own lines to rename against D1; the
  hand-off field strips like `TaskSeat`. D4's `seats` value reaches `goals/` too.
- **Amended after merge, the D9 sweep (2026-10-07)** — [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and the product owner's answer of
  the same day flipped D2: stored names are renamed outright, and the kitchen-sink app's and the
  DevTeam lab's stores are reset once. The `LEGACY_` constants, the upgrading page and its rename
  table, the changeset rows, V5 and the refusal-module exception (BR-12) went with it
  ([EVOLUTION.md](EVOLUTION.md#amendment-d9)).
- **Amended after merge, the board's seat (2026-10-07)** — the product owner chose assignee for a
  task board's seat ([epic D7](../../epics/FIX-1786/DECISIONS.md#d7)), which flipped D1: the
  board's types, its docs and the hand-off record are renamed, the glossary defines assignee only,
  and the guard's board-seat exceptions and board surface went
  ([EVOLUTION.md](EVOLUTION.md#amendment-d9)).

**Open: none.**
