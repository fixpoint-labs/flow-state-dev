# POC · a view's `dependsOn`, checked against what it reads

Retained design evidence for FIX-2621, not production code. Throwaway.

**Question.** Can a test fail a view that reads something its `dependsOn` does not declare, on
the real read paths, at a cost a developer would keep on? Epic FIX-2618's O2 rests on it.

**Run** (from the repository root, after `pnpm install`):

```bash
bash specs/issues/FIX-2621/poc/dependency-check/run.sh
FIX2621_RUNS=100 bash specs/issues/FIX-2621/poc/dependency-check/run.sh -t cost   # a long cost run, ~4 min
FIX2621_RAW=1 bash specs/issues/FIX-2621/poc/dependency-check/run.sh -t board     # every store call
```

**What it does.** Three real reads run through `runRead`, unchanged:

| Read | Path to its data |
|---|---|
| The conversation board's `listTasks_tasks` (`taskToolReads`, workforce's coordinator) | The board's resolver, the plan ledger, the roster, the session's own state |
| The claude-code-style lab's `listPins` | The user's state |
| `listTasks_todos` on a `taskBoard()` | The board's own recorded resolver (`boardResolverOf`), the handle `taskToolActions(board)` uses |

Three recorders, none of them inside the engine:

- **Store**: the spec's planned method, the read-only stores' twin. A proxy over every store,
  mapping each call to a scope's state or the resource whose prefix covers the key.
- **Context, in place**: the block's own `ctx` and scope objects keep their identity; the
  resource registry is proxied, and properties are redefined on the objects themselves.
- **Context, proxy**: `ctx` and the scope objects behind proxies, which see each scope's `state`.

Each read's `dependsOn` is written by hand. The board's was written after exploratory runs
showed what it reaches, which is what the check is for: the first draft, `[tasks]`, fails.
Every control (one entry left out) is asserted to fail, naming that entry, before the full
declaration's pass counts. The controls run against what either context recorder saw. A fourth
read, the probe, reads user state one block down, in a sequencer step.

**Result, 2026-11-10** (`main` at 21aef7b4):

| Read | In place saw | Proxy saw | Store saw besides | Controls |
|---|---|---|---|---|
| Board | `tasks`, `plan`, `workforceWorkers` | `tasks`, `workforceWorkers`, `session.state` | `projects`, `user.state`, `org.state`, `request.list` | 4 of 4 fail, each naming its entry; first draft `[tasks]` fails naming the other three |
| Pins | nothing | `user.state` | `session.state`, `org.state`, `request.list` | 1 of 1 fails |
| `taskBoard()` handle | `todos` | `todos` | `session.state`, `user.state`, `org.state`, `request.list` | 1 of 1 fails |
| Probe, one step down | nothing | nothing | (the same context loads) | **unseen** |

**Cost.** Each variant runs in rotation, so each one runs equally often in each position. The
figure is the median of the per-round differences, which cancels the drift below:

| Paired median, ms | Board | Pins |
|---|---|---|
| store − plain, default run (200 per variant) | −0.014 | +0.027 |
| in place − unrecorded copy, default run | +0.044 | −0.044 |
| proxy − unrecorded copy, default run | **−1.063** | −0.101 |
| store − plain, long run (500 per variant) | +0.073 | −0.058 |
| in place − unrecorded copy, long run | +0.309 | −0.154 |
| proxy − unrecorded copy, long run | **−1.850** | −0.134 |

Medians of whole runs: about 12 ms (board) and 16 ms (pins) in the default run, and 36 ms and
45 ms in the long run, where the drift below dominates. The identity-safe recorders cost at
most 0.3 ms per run, under 1% of the read, and most figures sit within ±0.15 ms of zero. The proxy's 1 ms
"saving" on the board is work it skipped: it never reaches the plan ledger. An earlier version
of this POC ran the variants in a fixed order and proxied the context. It reported the context
recorder as 9–12% *faster* than plain and called that noise. It was this skipped branch.

**What it showed.**

1. **The check works at the context, not at the store.** The store recorder sees everything the
   read's context loads (the session, user and org records, the request list, the flow's eager
   resources), whether the view reads it or not. A `dependsOn` passing it must declare all of
   that, which turns every view into "depends on everything its flow loads".
2. **No recorder outside the engine is sound.** The engine defines a scope's `state` as a
   non-configurable getter, so in place can't see it. A proxy can, but code keys state by those
   objects' identity (workforce's verified worker is a WeakMap on the session object). Behind a
   proxy the board takes another branch and never reads its plan ledger, so the proxy misses a
   real dependency *and* changes what the view does. Between them the two recorders catch every
   dependency here, but neither does alone.
3. **A child block is unseen by both.** The engine builds each block's `ctx`, so a read reached
   through a composed step (or any block a capability adds as a step) escapes a recorder on the
   view's own block.
4. **All three gaps close in one place: inside the engine's context.** That means the state
   getter, the resource registry, and wherever the engine builds each block's context.
   Recording there keeps identity, sees `state`, and sees every block. FIX-2623 builds it there.
5. **Recording costs under 1% of a read**, once it doesn't change the run.
6. **A hand-written `dependsOn` drifts on day one.** The board's obvious declaration misses
   the plan ledger, the roster and the session state, all reached through the board's resolver.

Paths not exercised by these reads, listed so nobody reads the table as covering them: a
projected collection (FIX-858) reaches its source through its read hook, which a context
recorder sees as a resource access and the store recorder doesn't see at all; a handle held
outside `ctx` (a module-level store or client) is invisible to all three.

A run at `FIX2621_RUNS=500` (2,500 per variant) did not finish within 30 minutes, because of
the drift below.

**Aside, not this POC's question.** A plain read's time grows across a run: on the board, about
6 ms over the first 40 runs and 24 ms over the last 40 in the default run, and 8 ms to 52 ms
over the long run. The cause is unexplained, and it isn't
the recorders, since it shows on the plain variant. It's worth a look before a view runs once
per watcher per change.
