# Plan — Framework simplification & cleanup

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

Sequencing, not building. What order the epics run in, what each hands the next, and what is
deliberately not next. Each epic's own plan owns its checks.

![The arc: sixteen epic lanes from Aug 10 to Nov 25. Declared surface ran inside one day, Aug 12, and is done. Durable storage ran Aug 13 to Aug 28 and is done. Verified identity's direction merged Sep 22 and its bar runs to the now line with its one child not started. Keeping flows alive's direction merged Sep 29 and its bar runs to the now line with four of eight children done. One owner per fact, filed Oct 15, and durable agents, filed Oct 24, have no bar: both are in Backlog, though some of their children are done. The mechanism sweep ran Oct 30 to 31 and is done. Clean SDK's direction merged Nov 5 and it wrapped Nov 15. Vocabulary, feature kits and docs revamp each had their direction merged within a day or two of filing, Nov 7, Nov 9 and Nov 12, and run to the now line. Kit reads in the apps was filed Nov 11, its direction merged Nov 17, and it runs to the now line. Showcase kits, filed Nov 18, has no bar though three of its children have implementation PRs open. Kit system evolution, filed Nov 22, has no bar. Coder selection was filed Nov 22, its direction merged Nov 23, and it runs to the now line with two of five children done. Sessions reach each other, filed Nov 25, has no bar: its epic spec is being authored.](figures/arc.svg)

Two short closed bars in August, two long live ones since late September, then twelve epics filed
in under six weeks. Clean SDK is the first of those to close a long bar: ten days from direction to
wrap. Four more run behind it, three approved within two days of filing and kit reads in the apps
within six. Verified identity's bar is still direction only, nine weeks on. Two Backlog epics have
children landing with no approved direction above them, and showcase kits has implementation PRs
open the same way. Kit system evolution, filed Nov 22, has no bar: it is open thinking. Coder selection's
direction merged the day after it was filed, Nov 23, and two of its five children are done.
Sessions reach each other, filed Nov 25, has no bar yet: its epic spec is being authored.

## What each epic consumes and releases

| Epic | Consumes | Releases |
|---|---|---|
| **declared surface** · FIX-1127 | A verification pass over this project's then 29 open issues, which closed 12 as shipped or superseded | **Released Aug 12:** a getting-started path that runs, flow options that are honoured or refused, declarations that stay on their block. Eight follow-ups filed |
| **durable storage** · FIX-1157 | Both storage primitives and their two conflict-retry drivers | **Released Aug 28:** increment and append on resources, one mutation contract, a delete that stays deleted; the write contract given one home in the docs. Decided once 2 and 3 |
| **verified identity** · FIX-1503 | Principal-owned org identity, already done outside any epic | A host-proof token mint, `/api/flows` verified by default, the two open reads closed, every HTTP consumer cut over, proved by the pentest Lab. **Not** login |
| **keeping flows alive** · FIX-1637 | The existing webhook, schedule and dispatch docs; Public Launch's queue-host session fence, pointed to and not moved | One guide, one glossary, one config matrix. **Not** a runtime change and **not** a new product noun |
| **clean SDK** · FIX-2447 | A review of what the Oct 16–31 window put on the public surface; every package root | **Released Nov 15:** curated package roots with no aliases, the adopter-goal check on installed tarballs passing on main `4d97cdc9a` with one expected-fail cell, `first-hour.quickstart`. Decided once 7 to 10, and PR-2. **Not** released: the quick start passing, 31 old `stores` lines, j5 in CI, all handed to [FIX-2739](https://linear.app/fixpoint-labs/issue/FIX-2739) |

## Coordination seams

- **Verified identity → keeping flows alive: one set of host-mount pages.** The config matrix
  teaches how a host is mounted for webhooks, cron and event ingress; the identity cutover changes
  how an HTTP caller proves who it is. Whichever lands second reads the other's pages, and
  [PR-1](BUSINESS-RULES.md) holds both. If the guide ships first, the cutover's docs sweep must
  include it.
- **Clean SDK → docs revamp: three leftovers in one issue.** [FIX-2739](https://linear.app/fixpoint-labs/issue/FIX-2739),
  owned by FIX-2696, flips `first-hour.quickstart` to pass once the rewritten quick start uses the
  `flows` list form, removes the 31 old `stores` lines, and folds j5 into the CI checks after
  release. The revamp also inherits decided once 8 and 9: one summary line for removed exports,
  and the install flag until FIX-2737.
- **Feature kits → kit reads in the apps.** FIX-2683 deletes the Teammates and Shift Manager read
  models only once FIX-2618's views, reads by scope, notice ids and kits have shipped.
- **Keeping flows alive → Public Launch: a pointer, not a dependency.** The guide documents the
  queue-host fence on delivering into an existing session honestly and links the fix in the hard
  gates epic. It never waits on that fix and never absorbs it.

## Before the epics

The original pass ran in May as 19 issues in three tiers: cleanup, editorial, refactors. **16 done,
1 canceled, 2 open.** Both open ones are package extractions: the model layer, still here and
waiting on the model-layer complexity question, and voice, since moved to the Realtime Voice
project. The tier structure is not carried forward; later work runs as epics or as single issues.

**78 open issues sit under no epic**, 29 of them bugs, among them clean SDK's handoff and
follow-up, FIX-2739 and [FIX-2737](https://linear.app/fixpoint-labs/issue/FIX-2737). The two largest clusters are resource-store
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
- **Writing the task-collection methods once**
  ([FIX-2462](https://linear.app/fixpoint-labs/issue/FIX-2462)), taken out of clean SDK into
  Backlog until it is settled whether workforce keeps its own task-collection methods.
