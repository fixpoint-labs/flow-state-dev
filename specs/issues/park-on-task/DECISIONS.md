# Park on a task · Decisions

[Spec](SPEC.md)

<a name="d1"></a>
## D1 · Can a worker on a task hand a piece to any worker, or only its delegates?

- **Plain terms.** Today a worker splitting its task can only hand pieces to the workers it delegates to. The ask is for a task to get a result from whoever has it.
- **Trade-off.** Any task-taking worker on the user's roster matches who `messageWorker` already reaches (FIX-1989), and is what makes the goal reachable. The price is that a worker can now put work on a teammate it doesn't manage, so a busy worker can get pieces it didn't expect.
- **Recommendation: any task-taking worker on the roster.** The chain limits (FIX-1802 S5) already bound how deep and wide this goes.
- **What would change my mind.** Workers getting pieces they shouldn't. Then reach becomes opt-in per worker (a "takes pieces from teammates" flag), with nothing persisted changing shape.
- **If wrong.** A narrowing later is one roster rule; no data migrates.

<a name="d2"></a>
## D2 · Whose answer does the filer get back from a split task?

- **Plain terms.** Today a split task completes with a list of its pieces' outputs. The worker reads them in the turn each ending wakes, but what it concludes there is dropped.
- **Trade-off.** The worker's answer is what a filer asked for ("find out and tell me"), and it is what makes the goal's report possible. The price: a split task's output changes shape for anyone reading the pieces' list today. The list stays, under the answer.
- **Recommendation: the worker's answer from the turn the last piece's ending woke, with the pieces listed under it**, and the pieces' list alone when no turn answered (a replay after a crash).
- **What would change my mind.** A filer that depends on the bare list. None does on `main` today (checked by the implementer before the change).
- **If wrong.** Reverting is one branch in the settle.

<a name="d3"></a>
## D3 · Does the coordinator hear a piece's ending?

- **Plain terms.** A piece's ending wakes the worker that filed it. The coordinator hears only when the whole task ends.
- **Trade-off.** One owner per ending keeps the coordinator's conversation about the work it handed out, not every step under it. The price: the coordinator doesn't see a piece land until the task does.
- **Recommendation: no, as the split does today.**
- **Change from the first draft.** That draft leaned toward the coordinator getting a line for each ending (its D4), and the product lead reported that lean as Jake's call. It belonged to a mechanism this draft drops. Merging this spec settles it the other way, so it is named here rather than changed silently.
- **If wrong.** Adding a line is one act in the notice handler.

## The first draft's decisions, under the split

| First draft | Under the split |
|---|---|
| **D0** no timer on a parked parent | Holds: the split's park has none |
| **D1** cancelling a parked parent cancels the child | Holds: `cascadeIfSplit` cancels open pieces |
| **D2** one child per park | Superseded: the split waits on every piece and wakes a turn for each ending, so one-at-a-time is the worker's choice, not a limit |
| **D3** `deps` stays same-board | Holds, unchanged |
| **D4** the coordinator hears a line | Changed: see [D3](#d3) above |
| **D5** a child's question unparks the parent | Holds: a piece's question wakes the turn of the worker that filed it, which answers it |
