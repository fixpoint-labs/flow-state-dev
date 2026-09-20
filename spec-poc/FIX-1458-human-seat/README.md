# FIX-1458 · a person in a seat, run rather than argued

Throwaway. Never merges. It exists so the gate on [spec/FIX-1458](../../spec/FIX-1458/SPEC.md)
is a decision about evidence rather than about a paragraph.

## Run it

```bash
pnpm tsx --tsconfig spec-poc/FIX-1458-human-seat/tsconfig.json spec-poc/FIX-1458-human-seat/run.mts
```

```bash
# The control. Must go red, and must go red FIRST at leg (b).
POC_CONTROL=no-park pnpm tsx --tsconfig spec-poc/FIX-1458-human-seat/tsconfig.json spec-poc/FIX-1458-human-seat/run.mts
```

The `--tsconfig` flag is not ceremony: `spec-poc/` is deliberately outside the pnpm workspace
so CI never reaches it, which also means it has no `node_modules` and bare `@flow-state-dev/*`
specifiers do not resolve. The tsconfig beside this file points them at source.

## The question

Can a person occupy the **same roster slot** an agent does — hired from the same tree, on the
same board, in the same inventory — with no new L1 type, no new task status, and no second
work plane? Everything downstream in W5 rests on the answer, and nothing had run it.

## What it showed

**The premise held.** A human seat is an ordinary hireable kind plus one setting.

| Leg | Claim | Result |
|---|---|---|
| a | The tree alone hires two seats; the human one carries `kind: "human"` — the exact value `openInventory` writes as its inventory row's `kind` | **Yes.** `hireWorkforce` was not touched |
| a · control | The same `principal:` on a kind that never declared it refuses the **whole** roster, by the key's name | **Fires.** `principal` is admitted by a kind's closed schema, never waved through |
| b | A row filed for the person's desk comes back `parked` carrying the seat's own reason, and the drain exits `parked-for-review` — while a row for the agent desk on the **same board** completes inline | **Yes.** The difference is the kind, not the board |
| c | Who owes it is derivable and stored nowhere: row → desk → the seat whose file answers for that desk → that seat's `principal:` | **Yes.** No `audience` field exists or is needed |
| d | The answer arrives in a **later request**: `unparkAndDrain` re-queues the row and the seat records the person's own words | **Yes.** The row settles `completed` carrying them |

The whole behavioural difference between a person and an agent is
[`human-kind.mts`](human-kind.mts)'s `humanDrain` — park when nobody has looked at this yet,
return the person's words when they have. It is the portable piece; everything around it is
the throwaway shell.

## The control, and why it cascades

`POC_CONTROL=no-park` swaps in the seat somebody writes when they treat a person as *an agent
that is slow*: it returns an answer instead of parking. Legs (c) and (d) read the row that (b)
parks, so they follow it down. That is a real dependency, not a second defect — the run
self-checks that (b) is where the red **starts**, and says so loudly if it isn't.

## What this does not grade, stated rather than implied

- **`openChannels` and `openInventory` are not run.** Both need a live host. What they record
  about a seat is `{ id, kind }` read off the hired flow copy, which leg (a) reads directly, so
  the inventory claim here is structural rather than observed. A person's row in a live
  inventory is FIX-1455's to show.
- **The board's seats are blocks in a registry**, which is the board's own *inline* seat model.
  A seat that runs in its own session is a `dispatcher({ type: "task" })`, and that arm is not
  exercised. Nothing in the human drain depends on which arm it is, but nothing here proves it.
- **No model runs.** Nothing here is a judgement call: a roster hires or refuses, a row is
  parked or is not, a desk resolves to a seat or does not.
- **One person, one seat, one org.** The two walls the spec leaves open — one human across
  several seats, and unbound principals in a channel — are not exercised, because nothing
  downstream waits on them.
