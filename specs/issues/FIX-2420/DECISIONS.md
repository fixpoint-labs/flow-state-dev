# FIX-2420 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: a once-per-fresh-checkout setup, its outcome recorded, the first
turn waiting on it. The epic places it (ER-5: the workspace host is extended, never a second
provisioning path; ER-2: optional, a host opts in). What's left is the shape.

<a name="d1"></a>
## D1 · A host option, run by the host as the last step of a provision

| | Host option (chosen) | A step in each caller (session flow, manager) | The repository's own `post-checkout` hook | Agent instructions |
|---|---|---|---|---|
| One place every coding path gets it | yes: every app builds a `localWorkspaceHost` | two copies, and each app's own host misses it | yes | yes |
| Covers a tree rebuilt from held work | yes | only if each caller re-derives "fresh" | yes | yes |
| Runs before anything else can start in the checkout | yes, under the place's lock | after the lock is gone | yes | no: the agent's own turn |
| Safe | the operator's command | the operator's command | **no**: a run can plant a hook; `NO_HOOKS` exists to stop exactly that | — |

- **Because:** provisioning is where a checkout is made, and where "is this fresh?" is known.
  ER-5 forbids a second provisioning path, and a caller-side step would be one.
- **Opt-in (ER-2):** absent, nothing runs and no field appears. No default changes for any app.
- **A command, not a function.** An argv run without a shell, through `exec.ts`'s `run`: an
  operator writes it in config, and its output gives the failure's tail for free. A host that
  needs a script runs `["sh", "-c", "…"]`.
- **Locks in:** setup belongs to the host, not the run. A run that wants more installs it itself.

<a name="d2"></a>
## D2 · A failed setup hands the checkout over, with the tail

| | Hand over, report (chosen) | Refuse the provision |
|---|---|---|
| The person sees why | yes: "Setup failed:" and the last 20 lines | yes, as a failed turn |
| The agent can still work, or fix what broke (a stale lockfile) | yes | no: the turn never starts |
| A stricter caller can refuse | yes, on `place.setup.status` | — |

- **Because:** the commonest failures (a lockfile out of date, a flaky registry) are ones the
  agent can fix or work around, and a turn that never starts can't. The issue asks for the
  outcome to be recorded, which only makes sense if the run goes on.
- **Locks in:** `WorkspacePlace.setup` is an outcome, not an error. Callers that need setup to
  have worked check it.

<a name="d3"></a>
## D3 · Once per fresh checkout, again until it succeeds

- "Fresh" is `repo.created`: every `worktree add` sets it, a rebuild from held work included,
  and a hand-back never does. A tree made again for an existing branch is fresh too.
- A marker beside the checkout (never inside it, so git never sees it) is written before the
  command starts and removed on exit 0. A failed or killed setup leaves it, so the next
  provision runs it again. A host that gains a setup command later doesn't set up checkouts it
  made before: they were never owed one.
- **Rejected: every provision.** `pnpm install` on a warm tree is seconds, but a turn shouldn't
  pay it, and a command that isn't idempotent would be run on top of a run's work.

<a name="d4"></a>
## D4 · Inside the provision's one budget

- The command's timeout is what's left of `provisionTimeoutMs`, and it runs under the place's
  lock. harness-manager sizes its checkout lease from that budget, so the arithmetic that keeps
  two attempts out of one checkout stays right with no change.
- **Locks in:** an operator whose install takes longer raises `provisionTimeoutMs` (ten minutes
  by default). The timeout's failure tail names it.
- **Rejected: a budget of its own.** Every caller that sizes a lease from `provisionTimeoutMs`
  would be wrong by the setup's length.

## Decided, not asked

- **E1 · `onSetup` beside `progress`, not a third `progress` state.** The manager writes
  `progress`'s value as a place state; "setting up" isn't one.
- **E2 · One `provision` shape, shared with FIX-2386 and FIX-2419.** The result is FIX-2386's
  `{ path, baseCommit?, branch?, setup? }`, or a bare path; this adds `setup`, and uses `path`,
  not `cwd`, because it is the same directory. The second argument is one request object,
  `{ onSetup, start? }`; this adds `onSetup`, and FIX-2419's `start` is a field beside it. A bare
  path records nothing, so Kitchen Sink keeps working before its stack wires it.
- **E3 · Task-board runs say it on the stream, not on the run record.** "Setting up the
  worktree…" is a live status; "Setup failed: <tail>" is kept. A record field waits for a page
  that reads it.
- **E4 · The tail is the last 20 lines, cut to 2,000 characters**, then how the command ended
  (its exit code, a timeout naming `provisionTimeoutMs`, or that it couldn't start).
- **E5 · Files places run nothing.** There is no repository to install for.
- **E6 · No app turns it on here.** Wave 1 touches no app file. Each app's stack adds one option;
  the epic coordinator places that.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, to check the controls fail before the
  checks are proposed. The spec PR carries the prototype runs.

## Notes from review

- FSD Architect (6d6dd2b): three specs were widening `provision` separately, with two names
  for the path. Folded: E2 extends FIX-2386's object, uses `path`, and names FIX-2386 and
  FIX-2419 under *What's already here*. The second argument is a single object, so FIX-2419's
  `start` and this `onSetup` don't compete for positions.
