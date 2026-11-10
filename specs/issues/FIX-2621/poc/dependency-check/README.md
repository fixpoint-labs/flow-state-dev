# POC · a view's `dependsOn`, checked against what it reads

Retained design evidence for FIX-2621, not production code. Throwaway.

**Question.** Can a test fail a view that reads something its `dependsOn` does not declare, on
the real read paths, at a cost a developer would keep on? Epic FIX-2618's O2 rests on it.

**Run** (from the repository root, after `pnpm install`):

```bash
bash specs/issues/FIX-2621/poc/dependency-check/run.sh
FIX2621_RUNS=100 bash specs/issues/FIX-2621/poc/dependency-check/run.sh   # a longer cost run
FIX2621_RAW=1 bash specs/issues/FIX-2621/poc/dependency-check/run.sh -t board   # every store call
```

**What it does.** Three real reads run through `runRead`, unchanged, under two recorders at once:

| Read | Path to its data |
|---|---|
| The conversation board's `listTasks_tasks` (`taskToolReads`, workforce's coordinator) | The board's resolver, the roster, the session's own state |
| The claude-code-style lab's `listPins` | The user's state |
| `listTasks_todos` on a `taskBoard()` | The board's own recorded resolver (`boardResolverOf`), the handle `taskToolActions(board)` uses |

- **Store recorder**: the spec's planned method, the read-only stores' twin. A proxy over every
  store, mapping each call to a scope's state or the resource whose prefix covers the key.
- **Context recorder**: the read's block run with `ctx` behind a proxy, recording each scope's
  `state` and each resource accessor it reaches.

Each read's `dependsOn` is written by hand. The board's was written after one exploratory run
showed what it reaches, which is what the check is for: the first draft, `[tasks]`, fails.
Every control (one entry left out) is asserted to fail, naming that entry, before the full
declaration's pass counts. A fourth read, the probe, reads user state one block down, in a
sequencer step.

**Result, 2026-11-10** (`main` at 21aef7b4):

| Read | Context saw | Store saw besides | Controls |
|---|---|---|---|
| Board | `tasks`, `workforceWorkers`, `session.state` | `projects`, `user.state`, `org.state`, `request.list` | 3 of 3 fail, each naming its entry; first draft `[tasks]` fails naming the other two |
| Pins | `user.state` | `session.state`, `org.state`, `request.list` | 1 of 1 fails |
| `taskBoard()` handle | `todos` | `session.state`, `user.state`, `org.state`, `request.list` | 1 of 1 fails |
| Probe, one step down | nothing | (the same context loads) | **unseen** |

Cost, 200 runs of each variant interleaved, median run: board 9.96 ms plain · 9.01 context ·
10.12 store; pins 9.03 · 8.98 · 9.27. Both recorders sit inside run-to-run noise (±10%). A
second run at 500 per variant agreed: context −11.6% and −0.5%, store −4.0% and −0.4%.

**What it showed.**

1. **The check works at the context, not at the store.** The store recorder sees everything the
   read's context loads (the session, user and org records, the request list, the flow's eager
   resources), whether the view reads it or not. A `dependsOn` passing it must declare all of
   that, which turns every view into "depends on everything its flow loads". It is never
   blind on these reads, but it never fails for the right reason either.
2. **One path the context recorder can't see: a child block.** The engine builds each block's
   `ctx`, so a read reached through a composed step (or any block a capability adds as a step)
   escapes a recorder on the view's own block. FIX-2623 must record where the engine builds a
   block's context, which is the one place every block passes.
3. **Recording costs nothing measurable.** Under 1 ms against a 9–10 ms read, inside noise.
4. **A hand-written `dependsOn` drifts on day one.** The board's obvious declaration misses
   the roster and the session state, both reached through the board's resolver.

Paths not exercised by these reads, listed so nobody reads the table as covering them: a
projected collection (FIX-858) reaches its source through its read hook, which the context
recorder sees as a resource access and the store recorder doesn't see at all; a handle held
outside `ctx` (a module-level store or client) is invisible to both.

**Aside, not this POC's question.** A plain read's time grows across a run: 6.1 ms over the
first 40 runs, 13.6 ms over the last 40, on the board. Unexplained; not the recorders, since
it shows on the plain variant. Worth a look before a view runs once per watcher per change.
