# FIX-1174 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. The *proved by* column is the check the plan runs.

## What leaves the package

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Anyone imports one of the sixteen remote names from `/cli` after the release | It is not exported; TypeScript and Node both fail the import | V1 · the package's `/cli` barrel lists none of them |
| BR-2 | Anyone searches the tracked tree for the path after the change | No live file mentions it; only changelogs, archived changesets and `specs/` remember it | V2 · the reference scan exits 0 |
| BR-3 | The package's suite runs after the removal | Every remaining test passes, including the resolver seam's | V3 |

## What must not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | Anyone uses the resolver seam from `/cli` | Same exports, same behaviour: the seam's source file and its test are unchanged | V4 · empty diff on both |
| BR-5 | Anyone imports from `/sdk` or the package root | Unchanged, including the deprecated envelope aliases | V3 · V5 |
| BR-6 | Any in-repo dependent of the package typechecks and tests | Green, with no edit to the dependent | V5 |

## The docs site

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | Someone opens the old remote-dispatch address | They land on the Claude Code SDK agent page | V6 · the built site holds the redirect |
| BR-8 | The docs site builds | No broken links, with the site's link check still set to throw | V6 |
| BR-9 | Someone reads the Tools section, the Claude Code SDK page or the coding-agents page | No link or sentence points at remote dispatch | V2 |

## Who gets told

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The package is next released | The changelog entry is a `minor` for `@flow-state-dev/claude-code` naming every removed export, saying there is no drop-in replacement, and naming `/sdk` as the nearest alternative | V7 · review of the changeset against [DOCS.md](DOCS.md) |

## Failure taxonomy

Nothing here runs at request time, so nothing degrades or retries. Every failure is a build-time
failure: a missed mention fails the scan, a missed dependent fails typecheck, a missed link fails
the docs build.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): the reference scan reports zero live
mentions, after it reported 20 on today's `main` and its `--control` run reported the planted
import; the package suite, every dependent's typecheck and the docs build are green.
