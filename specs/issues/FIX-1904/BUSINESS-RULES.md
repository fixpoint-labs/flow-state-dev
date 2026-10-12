# FIX-1904 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. Each says what a person or the system does and what happens; *proved by* is
the check the plan runs. Epic rules this issue owns or consumes are cited as ER-n
([epic rules](../../epics/FIX-1903/BUSINESS-RULES.md)): it **builds** ER-1 and ER-2, **consumes**
ER-3 and ER-13 from FIX-1906, and **obeys** ER-9, ER-10, ER-11 and ER-16. FIX-1905 later adds
ER-5 to ER-7 to the same profile.

## What a fresh open shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | `start` or `dev` runs with no `--config` | The `fsd` profile opens. Its projects are exactly FSD (`fsd`) and Shift Manager (`shift-manager`), both shared, both naming `https://github.com/fixpoint-labs/flow-state-dev.git`. FSD's brief names the framework packages; Shift Manager's names the app (ER-1) | Goal leg a · CI over the profile |
| BR-2 | It opens on a fresh store | No ask is raised and no workstream is opened (D2). Inbox and each project's Workstreams tab are empty | CI |
| BR-3 | It opens on a store that already holds the two projects | Nothing new is created and nothing is changed. A brief a person edited stays edited | CI, two opens on one store |
| BR-4 | `--config` names DevTeam's file | DevTeam opens exactly as before, on its own store, with the script by default (ER-10) | DevTeam's goal checks, rerun · CI |
| BR-5 | A person runs both profiles, one after the other | Each reads only its own store. DevTeam's Storefront never shows in `fsd`, and the reverse | CI |

## Which coder runs

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | `DEVFORCE_LAB_HARNESS` is unset or empty, and Claude Code reports an account | The coder is Claude Code. The start output says so in one line | Goal leg b · CI with a scripted probe |
| BR-7 | It is unset or empty, and Claude Code reports no account | The Lab exits non-zero before it listens. The message says to sign in to Claude Code or set `ANTHROPIC_API_KEY`, or to set `DEVFORCE_LAB_HARNESS=stub` for the scripted coder (ER-2, D1) | Goal leg c, and its control |
| BR-8 | The Agent SDK can't be loaded | Refused the same way, before it listens, saying the SDK is missing | CI with a failing loader |
| BR-9 | It is `stub` | The scripted coder, with no credential check. The start output says the coder is the script | CI (V2) |
| BR-10 | It is `claude-code` | The same as unset: Claude Code, with the check | CI |
| BR-11 | It names anything else | Refused at start, naming the two choices, as today | Existing CI |
| BR-12 | Any start, any choice | A run never uses the script unless `stub` was asked for. Nothing falls back at start or at run time | Goal control `silent-stub` · CI |

## Where a run's work lands

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A coding item is filed on FSD or Shift Manager, from a conversation or a board | Its worktree is a worktree of the checkout the server runs from, its branch is in that checkout, and the branch starts from local `main`, not from the checked-out branch (ER-3, D3) | Goal leg b |
| BR-14 | The checkout mapping misses a run (a project the person made, a remote that differs from the row's, or a session with no `orgId` or another organization's) | Refused by name before any clone. Nothing is fetched from GitHub (D3) | Goal control `no-checkout` · CI |
| BR-15 | A private project is created with id `fsd` and this repository's remote | It gets no worktree of the checkout: only shared projects are mapped, and the mapping names the two in the Lab's organization (ER-13) | FIX-1906's control, consumed · CI over the profile's config |
| BR-16 | The profile is read for the checkout's location | The location is worked out at start from where the profile's file is. No file holds a machine path (ER-11) | Review · a grep in CI |

## Failure taxonomy

A missing credential, a missing SDK and an unknown coder name are fatal at start, and only at
start: each exits before the Lab listens and names the fix. A run the mapping misses fails that
run, by name; the Lab keeps serving. A chief-of-staff turn with no model key fails that turn with
the provider's error, as today. Nothing retries, and nothing degrades to the script.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to c pass on one commit, after
`GOAL_CONTROL=silent-stub` failed leg c and `GOAL_CONTROL=no-checkout` failed leg b. DevTeam's
goal checks still pass. The [DOCS.md](DOCS.md) operations are published, with the overview's
stale project list fixed. The epic's closure ([ER-20](../../epics/FIX-1903/BUSINESS-RULES.md#the-closure))
reruns all of it with Linear.
