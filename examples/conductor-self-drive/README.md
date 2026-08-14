# conductor-self-drive

What configuring conductor actually looks like, and something small for it to work on.

Conductor is development orchestration: you hand it a work item and it drives that item
through spec, implementation, and PR feedback, dispatching the coding to whichever agent
harness you have installed, and stopping at the points where a human decision is genuinely
required. This example is the smallest complete setup — a config file, and a piece of source
for conductor to change.

## The config file, in full

```ts
import { defineConductor } from "@flow-state-dev/conductor";

export default defineConductor();
```

That is not a trimmed excerpt. `conductor.config.ts` really is one import and one call, and
the comment block at the top of the real file is longer than the code.

Four things conductor needs before it can start, none of them configured here:

| Not configured  | Discovered from                                               |
| --------------- | ------------------------------------------------------------- |
| the repository  | `git remote get-url origin`, in the checkout conductor runs in  |
| GitHub auth     | `GITHUB_TOKEN` / `GH_TOKEN`, the variables `gh` already uses    |
| the base branch | the remote's HEAD                                              |
| the dispatcher  | the coding harness that is installed (the `claude` CLI, today)  |

The reasoning is worth stating, because it is what keeps the surface from growing: conductor
is already sitting in a git checkout with a remote and an installed CLI, so asking for any of
that would be a knob that shouldn't exist. Worse than redundant — a second place for one fact
to live, which is how the config and the machine end up disagreeing.

A field earns its place only when it encodes an intent the environment cannot reveal. Fields
do exist for the cases inference genuinely can't cover — a fork whose pull requests belong
upstream, a checkout with several remotes, one conductor driving a repo it isn't inside, and
the guidance documents conductor should read — and a level-1 project sets none of them.

Discovery that can't answer raises an error naming the field that overrides it. There is no
fallback to `main`, and no "dispatch to whatever we shipped first." Both of those failures
surface twenty minutes later as something else.

Where the file lives: in a repo that adopts conductor it sits at the root. Here it sits in the
example's own directory, so that adding this example doesn't put the flow-state-dev repo
itself under management. Discovery walks up to the enclosing checkout either way.

## The thing conductor changes

`src/operations.ts` is a registry of named string operations. Two ship with it:

```
$ pnpm ops
upper	Uppercase every character.
lower	Lowercase every character.
```

A work item against this example is "add the `<name>` operation." That is a deliberately
boring change, and boring is the point — whether it got done is a command, not a judgement:

```
$ pnpm tsx src/cli.ts upper "flow state"
FLOW STATE

$ pnpm verify
ok — 2 operation(s) registered
```

`--verify` checks the registry still holds together: unique names, a summary on each, an
`apply` that returns a string. An operation added carelessly fails it.

The whole example is dependency-free, which is not tidiness. A dispatched phase does its work
in a bare git worktree with no `node_modules` in it, so the change conductor makes has to be
runnable from there.

## Running it

```bash
pnpm --filter @flow-state-dev/example-conductor-self-drive ops
pnpm --filter @flow-state-dev/example-conductor-self-drive verify
pnpm --filter @flow-state-dev/example-conductor-self-drive exec tsx src/cli.ts lower "FLOW STATE"
```

## Putting a work item under management

There isn't a command for that yet. Conductor currently ships the entity model, the
deterministic driver, the GitHub reader, the dispatcher seam, and this config layer; the tick
that assembles them and the CLI that fronts it are the remaining work.

The check that says so is `goals/conductor/drives-one-issue-to-a-merge-ready-branch` — a goal
that drives this example end to end and asserts what came out. It resolves this config for
real, then fails with a list of what is still missing. That list is the definition of done.
