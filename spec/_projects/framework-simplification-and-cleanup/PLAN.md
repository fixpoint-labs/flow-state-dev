# Plan — Framework simplification & cleanup

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc: four epic lanes from Aug 10 to Sep 29. The declared-surface epic ran inside one day, Aug 12, and is done. Durable storage ran Aug 13 to Aug 28 and is done. Verified identity's direction merged Sep 22 and its bar runs to the now line, Sep 29, with no child started. Keeping flows alive was filed and had its direction merged on Sep 29, so its bar is a sliver at the now line.](figures/arc.svg)

Two short closed bars in August, then nothing for three weeks, then two epics a week apart. The
live bars are direction only: neither epic has a child started, so each width is time since
approval, not work done. Keeping flows alive was approved the day it was filed.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **declared surface** · FIX-1127 | A verification pass over this project's then 29 open issues, which closed 12 as shipped or superseded | **Released Aug 12:** a getting-started path that runs, flow options that are honoured or refused, declarations that stay on their block. Eight follow-ups filed |
| **durable storage** · FIX-1157 | Both storage primitives and their two conflict-retry drivers | **Released Aug 28:** increment and append on resources, one mutation contract, a delete that stays deleted; the write contract given one home in the docs. Decided once 2 and 3 |
| **verified identity** · FIX-1503 | Principal-owned org identity, already done outside any epic | A host-proof token mint, `/api/flows` verified by default, the two open reads closed, every HTTP consumer cut over, proved by the pentest Lab. **Not** login |
| **keeping flows alive** · FIX-1637 | The existing webhook, schedule and dispatch docs; Public Launch's queue-host session fence, pointed to and not moved | One guide, one glossary, one config matrix. **Not** a runtime change and **not** a new product noun |

## Coordination seams

- **Verified identity → keeping flows alive: one set of host-mount pages.** The config matrix
  teaches how a host is mounted for webhooks, cron and event ingress; the identity cutover changes
  how an HTTP caller proves who it is. Whichever lands second reads the other's pages, and
  [PR-1](BUSINESS-RULES.md) holds both. If the guide ships first, the cutover's docs sweep must
  include it.
- **Keeping flows alive → Public Launch: a pointer, not a dependency.** The guide documents the
  queue-host fence on delivering into an existing session honestly and links the fix in the hard
  gates epic. It never waits on that fix and never absorbs it.

## Before the epics

The original pass ran in May as 19 issues in three tiers: cleanup, editorial, refactors. **16 done,
1 canceled, 2 open.** Both open ones are package extractions: the model layer, still here and
waiting on the model-layer complexity question, and voice, since moved to the Realtime Voice
project. The tier structure is not carried forward; later work runs as epics or as single issues.

**55 open issues sit under no epic**, 26 of them bugs. The two largest clusters are resource-store
correctness, where stores disagree or silently discard a write, and model strings. Neither has an
epic yet.

## What is deliberately not next

- **An epic for every open issue.** A single bug with a known fix takes the bug route on its own;
  an epic is for a set sharing one objective.
- **The model-layer extraction** before the question of how much of that layer is essential is
  answered.
- **Session delivery on a queue host.** It is Public Launch's hard gate; this project only
  documents the fence.
- **A heartbeat or keep-alive product.** Keeping flows alive teaches what exists.
