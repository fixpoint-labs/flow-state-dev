# driver

The pure part. Every decision conductor makes happens here, and nothing here does any
I/O — by the time these functions run, each fact they need is already a plain field on a
`World` snapshot that somebody else fetched.

That is the point, not an accident of the current code. It is what makes the whole
phase × gate × signal matrix testable by handing it a literal.

| File | What it does |
|---|---|
| `decide.ts` | `decide(entity, signal, world) → Action[]` — one signal in, the actions that follow out |
| `derive-gate.ts` | works out what an entity is waiting on, and whether its phase is finished |
| `reconcile.ts` | diffs conductor's copy of the world against the world, and emits the signals it missed |

```
observed + fresh ──reconcile()──▶ Signal[] ──decide() per signal──▶ Action[]
```

Three properties these files hold:

- **A gate is recomputed, never remembered.** `deriveGate` reads a snapshot, so killing
  the process while an entity waits on a gate loses nothing — the next tick derives the
  same gate from the same world.
- **Unknown input is inert, never fatal.** An unrecognized signal, a phase that does not
  belong to the entity kind, a signal addressed elsewhere: all reduce to no actions rather
  than crashing the tick.
- **Reconciliation invents no vocabulary.** A missed `pr_opened` is re-emitted as an
  ordinary `pr_opened`, backdated and marked synthesized, so a recovered history and a
  live one reduce identically.

No model runs in here. Judgment upstream of a signal is welcome — classifying a human
comment is real judgment — but it has to be recorded as a signal before it is acted on,
which is what keeps every transition replayable from the ledger.
