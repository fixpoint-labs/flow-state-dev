# FIX-1876 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The vocabulary itself is not decided here. The product owner fixed it in the epic's
[D3](../../epics/FIX-1870/DECISIONS.md#d3) on 2026-10-11: *ask* is a question to a person,
*hand-off* is passing your own work on mid-work, new work is *dispatched*, and a caller *waits*.
These cards decide how far the rename reaches, what happens to records written under the old
names, and how the change is cut.

## The tree

```mermaid
flowchart TD
  E["FIX-1876 · one word per thing"] --> D1["D1 · every use, public names included, held by a sweep"]
  D1 -.->|"rejected"| X1["the issue's listed internals and the glossary"]
  D1 -.->|"rejected"| X1b["public names and pages, comments and tests left"]
  E --> D2["D2 · read the old marks, rewrite nothing"]
  D2 -.->|"rejected"| X2["a one-time rewrite of stored records"]
  E --> D3["D3 · three PRs · wait, dispatch, published words"]
  D3 -.->|"rejected"| X3["one PR over about 290 files"]
```

<a name="d1"></a>
## D1 · Rename every use that carries the old meaning, and hold it with a sweep

| | |
|---|---|
| **Instead of** | The issue's list: `row.ask`, `parkOnAsk`, `askGateId`, `resumeOwedAsks`, `isAskGate`, the `fsd.ask.*` keys, `createHandOff`, `handedOffTaskPredicate`, `assertHandOff*Supported`, and the glossary · or public names and published pages only, with code comments and tests left as they are |
| **Because** | The listed names are the tip. The sweep ([`poc/vocabulary-sweep/`](poc/vocabulary-sweep/sweep.mjs)) found 2,156 open lines in 289 files on 2026-10-12: 995 in the wait family (identifiers such as `AskEndedError`, `resumeAsk` and `hasAskSweeper`, the stored marks, and phrases like "an asked row"), 1,156 in the dispatch family (968 "hand-off" phrases, 330 identifiers), and 7 stale `post-to-mailbox` mentions. Some wait-family lines will turn out to be questions to a person and be kept; the count is before that classification. The board's dispatcher assignee, a shipped feature, is called "hand-off" in its section title, its `"handed-off"` ending and its block's output. A reader of the API reference, a stack trace or a test name meets the old word as often as a reader of the glossary. D3's reason, "a word that names two things makes a reader look for two mechanisms", applies to all of them ([tenet 1](../../../docs/philosophy.md#1-coherence-over-local-cleverness), [tenet 6](../../../docs/philosophy.md#6-readability-is-an-output)). And only a rule that covers every file can be checked; "public names, but not comments" has no test a machine can run, so it drifts back ([tenet 7](../../../docs/philosophy.md#7-prove-the-goal-not-the-mock)) |
| **Locks in** | The sweep's rules are the definition of done. After this, *hand-off* names nothing in code; the word waits for mid-work hand-off. Exported names are renamed with no deprecated alias, as FIX-1875 does for `waitForResponse` (pre-1.0, a `minor` changeset). The `isTaskDispatcher` named in the issue stays: it already says dispatch |

**What would change my mind:** the owner judging comments and tests not worth the churn. Then the
sweep's rules narrow to names and published pages, and the count roughly halves;
nothing else in the plan changes.

![D1: how far the rename reaches. Chosen: every use, public names, comments and tests included, held by a sweep. Instead of: the issue's listed internals and the glossary. It comes down to the first row: what a reader meets. The listed set leaves AskEndedError, resumeAsk, the handed-off ending and about 970 hand-off phrases in place. Second row, the price: about 2,150 lines in 289 files and a breaking rename of exported names, against about 130 lines. Third row: only the full rule can be checked by a machine. Locks in the sweep as the definition of done and hand-off reserved for mid-work. Flips if comments and tests are judged not worth it](figures/d1-every-use.svg)

It comes down to what a reader meets: the listed set leaves the old word in the API and the board.

<a name="d2"></a>
## D2 · Read the old marks; rewrite nothing in the store

| | |
|---|---|
| **Instead of** | A one-time migration that rewrites stored records to the new names, which is what the issue's "with a migration for rows already marked" first suggests |
| **Because** | Four things are written under the old names and outlive a deploy: a task row's `ask` field, a suspension's reason `"ask"`, the `fsd.ask.step`, `fsd.ask.plan` and `fsd.ask.file` run-once entries, and the `"handed-off"` ending in a board's item log. A turn parked on a wait when the server upgrades must find all of them, or it never resumes and the colleague's answer is lost. There is no migration runner across the memory, SQLite and Postgres stores and resource-backed collections, and a rewrite would race a turn that is resuming. Reading both names is what [BP-030](../../../docs/contributing/best-practices.md) asks for |
| **Locks in** | Every reader of the four marks accepts the old value and the new one; every writer writes only the new one. Each legacy reader carries a `legacy-name:` comment on its line, so the sweep counts it and a reviewer sees it. The security reading goes with it: an old `"ask"` gate is still a wait gate, so the public resume route still refuses it ([WR-3](BUSINESS-RULES.md#records-written-before-the-upgrade)) |

**What would change my mind:** a store migration runner shipping before this builds. Then rewrite
once and drop the readers.

![D2: what happens to records written under the old names. Chosen: read both names, write only the new. Instead of: a one-time rewrite of stored records. It comes down to the first row: a wait parked across the upgrade. Reading both resumes it; a rewrite races the resuming turn and has no runner across four store kinds. Second row, the price: legacy readers stay in the code, each marked, against none after the rewrite. Third row, a tie: new records look the same. Locks in every reader accepting both and an old ask gate still refused from outside. Flips if a store migration runner ships first](figures/d2-read-old-marks.svg)

It comes down to a wait parked across the upgrade: a rewrite races it and has no runner.

<a name="d3"></a>
## D3 · Three PRs in a chain: wait, dispatch, then the published words

| | |
|---|---|
| **Instead of** | One PR over about 290 files |
| **Because** | The two families touch different packages and different stored marks. The wait family is `core`, `engine`, `orchestration` and `workforce`, with three of the four marks. The dispatch family is the task board, its ending and its pages. Each PR passes the sweep for its own family (`--only ask`, `--only handoff`), so a reviewer reads one rename map at a time. The third publishes the shared narrative and the glossary once both names exist, and runs the sweep at full scope |
| **Locks in** | P1 wait, then P2 dispatch, then P3 published words, merged in that order. P1 and P2 each fix any published page their renames break, so no merge leaves a page naming a symbol that is gone |

**What would change my mind:** FIX-1875 and FIX-1872 renaming most of the wait family
themselves. Then P1 and P2 fold into one.

![D3: how the change is cut. Chosen: three PRs in a chain, wait, then dispatch, then the published words. Instead of: one PR over about 290 files. It comes down to the first row: what a reviewer can read. Each PR carries one rename map and passes its own part of the sweep. Second row, the price: three reviews and two waits between merges. Third row, a tie: the same end state. Locks in the order and each PR fixing the pages its renames break. Flips if the two upstream issues rename most of the wait family](figures/d3-three-prs.svg)

It comes down to what a reviewer can read: one rename map per PR.

## Decided, not asked

- **The new names follow the error codes already shipped.** The codes a model reads are
  `wait_timed_out`, `wait_task_failed` and `wait_task_cancelled`, so the gate is a *wait gate*.
  A dispatched row's ending is `"dispatched"`. Pinned in [PLAN.md](PLAN.md#pinned-names).
- **Whatever FIX-1875 or FIX-1872 already renamed, they own.** If either renames a name on the
  list, its choice stands and the sweep simply stops finding it.
- **The old docs anchor keeps working.** `#assignees-that-hand-off` stays as an explicit anchor
  on the renamed section, so links from outside the site still land.
- **Retained specs, changelogs and goal directories keep their words.** They record history and
  the closure's addresses. FIX-1815's "Hand-off (Layer 1)" definition is superseded through
  [EVOLUTION.md](EVOLUTION.md), not edited.
- **The regression checks change by names only.** FIX-1816's check reads a row's `ask` field. P1
  changes that one read to `wait` and lists it in the rename map, which is what
  [ER-11](../../epics/FIX-1870/BUSINESS-RULES.md#what-no-child-may-do) allows.
- **Pending changesets that announce `post-to-mailbox` are amended.** The tool was removed before
  they released, so the next release notes must not announce it. Verdict rows in goal logs that
  mention it are history and are kept.

## Which methods already do this job

The job is naming, not a mechanism: this issue adds no method, tool or entry. The one fold it
applies is the epic's, one word per mechanism. Searches: the six sweep rules over every tracked
file. Closest entry: none.

## Considered and dropped

- **Deprecated aliases for the exported names.** One release of `parkOnAsk` beside `parkOnWait`.
  Dropped: nothing outside the framework calls them in this repository, the project is pre-1.0,
  and FIX-1875 removes `waitForResponse` with no alias. An alias is also an open sweep hit.
- **A CI lint now.** The sweep could run in CI and keep the words out for good. Dropped from this
  issue as new tooling with its own false-positive cost; filed as a follow-up in
  [PLAN.md](PLAN.md#follow-ups).

## Open

None.

## Settled

- **The size of the job.** The issue lists about fifteen names; the sweep counts 2,156 open lines
  in 289 files on `main` at `da8f63fd7`. Re-derive with `node specs/issues/FIX-1876/poc/vocabulary-sweep/sweep.mjs`.

## How it got here

- **Draft (2026-10-12)** — the vocabulary is the epic's D3; the spec decides reach (every use,
  held by a sweep, after the sweep showed the issue's list missed the board's whole
  dispatcher feature and most of the wait gate's exported names), records
  written before the upgrade (read both names), and the cut (three PRs).
