# FIX-1903 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who
owns it and where it's checked.

## What a person gets, and what they don't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | `pnpm shift-manager:dev` and `start`, given no `--config`, serve the dev profile: two shared projects, FSD (the framework packages) and Shift Manager (the app), both naming this repository's remote, each brief stating its focus. `--config` with DevTeam's file serves DevTeam as before ([D2](DECISIONS.md#d2)) | FIX-1904 builds · FIX-1905, FIX-1906 consume | The closure · DevTeam's goal checks, rerun |
| ER-2 | The dev profile's coder is what [Q1](DECISIONS.md#q1) decides. Whatever it is, a run never falls back to the scripted coder without saying so, and an unknown harness name is refused at start | FIX-1904 | FIX-1904's tests · the closure |
| ER-3 | A project's `repository` stays a remote. The host maps a remote to a checkout on its machine for the project ids its config names ([ER-13](#what-no-child-may-do)), and a run for a mapped project is a worktree of that checkout, its branch kept there, with the project's files beside the worktree and never in it ([D3](DECISIONS.md#d3)) | FIX-1906 decides · FIX-1904 consumes | FIX-1906's tests · the closure's `git worktree list` |
| ER-4 | Two runs on two projects mapped to one checkout, at once, get two worktrees and two branches, and both settle. A test proves it, with a control that gives both runs one place and must fail | FIX-1906 | FIX-1906's tests · the closure's leg b |
| ER-5 | A project may name MCP servers, by host-approved alias ([ER-14](#what-no-child-may-do)). A coding run gets its project's servers when it starts, read from the project its own task row names, never from a hand-over's payload. A run whose project has none gets none ([D4](DECISIONS.md#d4)) | FIX-1905 decides · FIX-1904 consumes | FIX-1905's goal check, on a run not handed over by a coordinator |
| ER-6 | No credential, endpoint or credential variable is stored on a project row. A row selects MCP servers by an alias the host approves; the host config gives each alias its endpoint and the environment variable that holds its credential, and the host reads it. The value reaches the MCP connection only: not the run's environment, a log, a session or the page. The dev profile's host config has one alias, `linear`, whose variable is `LINEAR_MCP_API_KEY`, the name the kitchen-sink's Linear capability reads (`apps/kitchen-sink/lib/mcp.ts`); each person signing in to Linear as themselves is a later epic | FIX-1905 | FIX-1905's tests · its spec review |
| ER-7 | A server whose credential variable is unset is said out loud, once when the server starts and on each run that misses it. The run still runs, and that is a degraded run, not a pass: with `LINEAR_MCP_API_KEY` unset, the closure's leg a must FAIL its title check ([ER-20](#the-closure)) | FIX-1905 | FIX-1905's tests · the closure, run with the variable unset |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | Build on the coordinator's `handOff` tool, or add an MCP or checkout field to `dispatchTask` | [D4](DECISIONS.md#d4). `handOff` retires in FIX-1872; hand-over is FIX-1870's |
| ER-9 | Add anything to Layer 1 (core, engine, orchestration). `workspace` and `claude-code` get at most one generic option each: a remote-to-checkout mapping, and per-run MCP servers | MCP settings and checkouts are Workforce and host concepts |
| ER-10 | Change DevTeam's projects, workstreams, ask or coder default | [D2](DECISIONS.md#d2). Five goal checks serve its config unedited |
| ER-11 | Put a machine's path in a project row, a `WORKER.md`, or a file the published package ships | [FIX-1762 BR-5](../../issues/FIX-1762/BUSINESS-RULES.md). A path belongs to the host that has it |
| ER-12 | Migrate stored projects. A row stored before FIX-1905 reads as a project with no MCP servers | [FIX-1786 ER-31](../FIX-1786/BUSINESS-RULES.md#what-no-child-may-do): no migrations while Workforce has no consumers |
| ER-13 | Resolve a checkout from a project row's remote alone. The remote-to-checkout mapping is the operator's host config and names the project ids it serves, or the host is declared a trusted single-user host. A row whose remote matches but whose id isn't named gets no worktree of the operator's checkout | A row's remote is caller-controlled ([BP-031](../../../docs/contributing/best-practices.md)); the checkout holds the operator's refs and unpushed work. The existing local-repository mode already needs an operator-approved path ([D3](DECISIONS.md#d3)) |
| ER-14 | Let a project row name an MCP endpoint URL or an environment variable. A row names a host-approved alias only, and an unknown alias is refused when the row is saved | A row is written by users and agents; a URL plus a variable name would let a row send any host secret to any endpoint ([D4](DECISIONS.md#d4), ER-6) |
| ER-15 | Build an issue picker. A person picks an item in conversation, naming a Linear issue to the chief of staff or a project's coordinator, and the agent reads it through Linear | The goal's "picks an item" is met in conversation; a picker is a later epic ([SPEC](SPEC.md#the-goal-and-how-well-know-its-met), "Bigger") |
| ER-16 | Say "seat" in docs or code. It is "worker" | [FIX-1786 ER-12](../FIX-1786/BUSINESS-RULES.md) |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-17 | A cross-cutting question goes to the epic coordinator, not decided in one child. After this spec merges, a change to it is a follow-up PR from `main` | The retained decisions are canonical |
| ER-18 | A child that joins the set blocks FIX-1919 from the wake that first sees it | Otherwise the closure could pass before it lands |
| ER-19 | A PR that depends on another is a stack. Agents never merge implementation PRs | The orchestration contract |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-20 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a and b pass on one `main` commit, leg a fails under its control, and every bug an earlier run found is fixed as a child of this epic | FIX-1919's goal check, a real coding agent, a real Linear issue |
| ER-21 | Every row in [DOCS.md's ownership table](DOCS.md#ownership) is published, and a person following the dev page as written reaches a first item | Each publisher's own PR · the closure follows the page |
