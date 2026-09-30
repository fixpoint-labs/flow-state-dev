# FIX-1174 · Retire the experimental `--remote` dispatch path from @flow-state-dev/claude-code

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement (removal) · `claude-code` + `apps/docs` · small · 1 PR · no epic

## People, before and after

| Someone who… | Today | After |
|---|---|---|
| **maintains or onboards to the Claude Code package** | Reads past a cloud-dispatch block, a terminal wrapper, an output parser and four test files that nothing in the repo calls | Sees the in-process agent and the resolver seam, and nothing else |
| **reads the docs site's Tools section** | Finds a "Claude Code (remote dispatch)" page for an experimental path that is going away | Finds one Claude Code page, the SDK agent. The old address redirects there |
| **imports the in-process agent (`/sdk`)**, as every in-repo user does | Works | Works, unchanged |
| **imports the remote-dispatch block from the published `/cli` entry** | Works, if they wrap it in a terminal | Gets an import error on the next minor. The release note names every removed export ([D1](DECISIONS.md#d1)) |
| **uses the `/cli` resolver seam directly** | Works | Works, byte for byte |

The remote path was always opt-in and needs a pseudo-terminal to run at all. Its owner has said it
is probably going away, and a search of every tracked file finds no caller outside the package.

## The goal, and how we'll know it's met

**The Claude Code package no longer ships, tests or documents the `claude --remote` path, and
nothing that uses the package breaks.**

| Is it the right goal? | |
|---|---|
| **The real need** | Less unused surface for maintainers, and the docs stop pointing readers at a path that is going away ([FIX-1174](https://linear.app/fixpoint-labs/issue/FIX-1174)) |
| **Smaller, and rejected** | "Delete the source files." Leaves the README, four docs pages, the sidebar and two doc comments describing a path that no longer exists, which is the half a reader actually sees |
| **Bigger, and not this issue's** | Reshaping the package around a headless path. That path is not on `main` (it lived on a pull request that closed unmerged), and the fence leaves the resolver seam alone |
| **Not done if** | The package suite is green but a dependent was never typechecked · the docs build passes only because the broken-link check was relaxed · a live mention of the path survives in a README or doc comment |

**No goal check applies:** this is a removal, with no new behaviour to exercise on a real path.
What proves the goal instead is the reference scan retained with this spec
(`poc/reference-scan/scan.sh`): it reads every tracked file and must report **zero live
mentions** of the path after the change. Its control must fail: on today's `main` it reports 20
live files, and `--control` plants one unlisted import and must report it. Alongside it, the
package's own suite, a typecheck of every in-repo dependent, and a docs build that throws on a
broken link ([PLAN → Checks](PLAN.md#checks)).

## What changes

![The claude-code package today and after: the /cli entry loses the remote dispatch block, capability, parser, terminal wrapper, handle type, errors and their tests, keeping only the resolver seam; /sdk and the root are unchanged; the remote-dispatch docs page is removed and its address redirects to the SDK agent page](figures/what-changes.svg)

Left is today, right is after. Everything green survives untouched; everything dashed red goes.

**The only code anyone writes differently** is a caller of the removed exports, and there is no
replacement to point them at:

```diff
- import { claudeRemoteDispatch, resolvePtyClaudeCli } from "@flow-state-dev/claude-code/cli";
- const dispatch = claudeRemoteDispatch({ resolveClaudeCli: resolvePtyClaudeCli });
+ // Removed. Run a Claude Code agent in-process instead:
+ import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
```

The `/sdk` agent is not a drop-in: it runs locally and streams, where remote dispatch handed work
to a cloud session and returned. The release note says so rather than implying a migration.

## What stays as it is

- **The resolver seam** (`/cli`'s `defaultResolveClaudeCli`, `defaultClaudeCliExec` and their
  types) and its test, byte for byte. The `/cli` entry keeps existing to export it. Fenced by the
  coordinator.
- **The `/sdk` entry and the package root**, including the deprecated envelope aliases.
- **Every in-repo consumer** — the integration suite, two labs and the goals workspace import
  `/sdk` only, verified by the scan.
- **History**: changelogs and archived changesets keep their mentions.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** code, tests and every live
mention gone, dependents and docs build green. If wrong: we leave docs describing a path that no
longer exists, or break a dependent nobody typechecked.

1. **[D1](DECISIONS.md#d1) · The remote exports are removed outright in a `minor` release, with
   a changeset naming all sixteen, instead of a deprecation release first.** If wrong: an
   outside user of `/cli` hits an import error on upgrade with no warning release before it.
2. **[D2](DECISIONS.md#d2) · The remote-dispatch docs page is deleted and its address redirected
   to the SDK agent page, instead of rewritten around headless use.** If wrong: someone looking
   for the CLI resolver finds no docs-site page for it, only the README.

**Open: none.** D1 is the one to weigh: it is the only user-visible break. Reasoning and what
lost: [DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
