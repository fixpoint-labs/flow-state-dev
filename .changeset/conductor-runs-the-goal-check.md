---
"@flow-state-dev/conductor": minor
---

Conductor runs the goal check itself, so a merged issue can actually finish (LAB-66).

`DispatchResult.goalCheck` has always required a verdict to come from something
with an exit status, and nothing could supply one: a coding harness reports how
its own agent loop ended, not the status of whatever the agent ran inside it. So
no dispatcher ever set the field, `awaiting_goal_check` was a gate nothing could
release, and every merged issue waited at it forever — looking healthy, because a
gate was named.

Declare the command that proves a work item and conductor runs it itself:

```ts
export default defineConductor({
  goalCheck: { command: ["pnpm", "tsx", "goals/run-for-issue.mts"] },
});
```

It appends the work item's id, runs it with no shell in a workspace detached at
the merged base, and reads the exit status: `0` passes, anything else fails,
nothing it prints is read. The command is declared and never discovered — it is a
program conductor executes, so scanning for something runnable is the one choice
it must not make — and a brief carries it outward only, so a dispatched agent can
run the same check but cannot change which one runs.

A command that could not run at all — missing, crashed, killed, timed out — claims
no verdict and asks a human, rather than reporting a broken runner as "the change
did not do what the issue asked". A project that declares no `goalCheck` proves
nothing and its issues are not held on proving it.

Also: a brief for a dispatch that writes nothing (`answerQuestion`,
`runGoalCheck`) no longer tells the agent to commit and push, and a dispatch
record now keeps what the execution had to say for itself.
