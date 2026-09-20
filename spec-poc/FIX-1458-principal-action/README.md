# FIX-1458 · Model B, run rather than argued

Throwaway. Never merges. It exists so the gate on [spec/FIX-1458](../../spec/FIX-1458/SPEC.md)
is a decision about evidence rather than about a paragraph.

**It replaces the round-1 POC** (`spec-poc/FIX-1458-human-seat/`), which proved a claim the
owner amend of 2026-09-20 superseded: *a person occupies a drain seat*. The two claims that POC
settled — a board seat can park its own row and the park survives the drain, and the answer can
arrive in a later request — are not lost; they are re-run here as legs (b) and (d), on an
**agent-owned** row.

## Run it

```bash
pnpm tsx --tsconfig spec-poc/FIX-1458-principal-action/tsconfig.json spec-poc/FIX-1458-principal-action/run.mts
```

```bash
# The controls. Each must go red, and each FIRST at the leg it names.
POC_CONTROL=trust-input pnpm tsx --tsconfig spec-poc/FIX-1458-principal-action/tsconfig.json spec-poc/FIX-1458-principal-action/run.mts
POC_CONTROL=no-park     pnpm tsx --tsconfig spec-poc/FIX-1458-principal-action/tsconfig.json spec-poc/FIX-1458-principal-action/run.mts
```

The `--tsconfig` flag is not ceremony: `spec-poc/` is deliberately outside the pnpm workspace so
CI never reaches it, which also means it has no `node_modules` and bare `@flow-state-dev/*`
specifiers do not resolve. The tsconfig beside this file points them at source.

## The question

**The work plane changes; the org chart stays.** Can a non-human seat own the row and park it,
a person answer through a **flow action bound to a principal**, the flow decide what the answer
means and carry on — with one listing still showing people beside agent seats, and no Human L1,
no new task status, and no second work plane? Everything downstream in W5 rests on the answer.

## What it showed

**The premise held, and it found one constraint nobody had stated.** 37 checks green.

| Leg | Claim | Result |
|---|---|---|
| a | The tree hires three seats and **none of them is a person** — one ordinary kind, no `human`, no seat declaring a personal identity. One agent seat carries the durable bind `reviewedBy: u_dana`; a sibling on the same kind carries none | **Yes.** `hireWorkforce` untouched |
| a · org chart | One read of that tree lists the seats **and** the people, a person appearing because a seat owes them a sign-off | **Yes.** Derived, stored nowhere |
| a · control | The same bind on a kind that never declared `reviewedBy:` refuses the **whole** roster, by the key's name | **Fires.** A kind's closed schema admits it or nothing does |
| b | An **agent-owned** row parks carrying its own seat's reason, the drain exits `parked-for-review`, another row on the same board completes, and a second drain does not re-take it | **Yes.** Nobody is standing in for a person |
| c | Who owes it is derivable and stored nowhere: row → desk → the seat that drains it → that seat's `reviewedBy:` | **Yes.** No `audience` field exists or is needed |
| c · null arm | The unbound desk's row names the **seat** and no person — which does not collapse into the answer for a row resolving to no seat at all | **Yes.** Three endings, not two |
| **d0** | A second principal answering **into the seat's own session** is refused by the runtime before any block runs | **Refused.** See *the constraint*, below |
| d1 | A stranger's request is refused, and the row is **untouched** — still parked, nothing recorded | **Yes.** The guard read `u_mallory` off the request |
| d2 | The same stranger **claiming to be Dana in the payload** is refused identically | **Yes.** Identity is not a field a caller fills in (BP-031) |
| d3 | A row owed to **nobody** refuses everybody, Dana included | **Yes.** An unbound desk is not an open door |
| d4 | **Repointed-roster control:** change which principal the tree binds and nothing else, and Dana's own request flips to refused | **Fires.** The check follows the tree, not a map it also wrote |
| d5 | Dana's own request unparks the row **in a later request**, and the **flow** — not the person — decides what her words meant | **Yes.** `released: approve — refund it` |
| e | The **authored** bind survives a JSON round-trip and a re-hire; the **imposed** `seatTools` comes back without its `execute` | **Yes.** Observed, not argued |

### The constraint this found, and did not assume

**A session belongs to one user.** `createExecutionContext` refuses a request that arrives on
another user's session — *"Session s_ops is owned by user u_boot but request supplied user
u_dana"* — before any block runs. So a person **cannot** answer into the seat's session, and a
board a second principal has to reach cannot be session-scoped to the first one's. The ledger
here is therefore **org-scoped**, and each principal arrives in their own session.

That is a design constraint, not a defect, and it cuts two ways. It is a second guard nobody
wrote: even an action with no principal check of its own cannot be reached across a session
boundary. It is also a real requirement on the lab wiring and on FIX-1455 — see
[DECISIONS.md → Open](../../spec/FIX-1458/DECISIONS.md#open).

### What leg (d) does and does not settle

It settles that **the check is possible and runs**: the caller comes from
`ctx.user.identity`, which the runtime stamps from the transport's own principal resolver, and a
mismatch refuses while the row stays parked. Under the superseded Model A there was no caller
identity at that point at all, so the check could not have been written.

It does **not** settle that any particular host authenticates well. There is no HTTP transport
here; `runAction({ userId })` is the seam a real host's `resolvePrincipal` fills. What the
`trust-input` control grades is exactly the distinction that survives that: whether the guard
reads **the request** or **the payload**. With the payload believed, the impostor's answer lands
and the row settles — six checks red, starting at leg (d).

## The controls, and why they cascade

`POC_CONTROL=trust-input` swaps one line — the caller comes from `input.claimedPrincipal`
instead of `ctx.user.identity`. It is what somebody writes when they let the client say who it
is. Red first at leg (d), and the row **settles on the impostor's answer**, which is the failure
made visible rather than described.

`POC_CONTROL=no-park` swaps in the seat somebody writes when they treat a row that needs a person
as a row that takes longer: it answers its own escalation. It swaps **both** parking desks,
because the defect it models is a wrong idea about the kind rather than one badly written desk —
with only one swapped, the other desk's park keeps the drain's exit reason green and the control
grades weaker than it reads. (Round 1 found that the hard way; it is still true here.) Legs (c)
and (d) read the rows (b) parks, so they follow it down — a real dependency, not a second defect.

Each control **self-checks where the red starts** and says so loudly if it starts anywhere else.
A control that goes red at (a) has demonstrated a broken harness, not a missing park.

## What this does not grade, stated rather than implied

- **No HTTP transport, so no real authentication.** Covered above; it is the single biggest
  thing to hold in mind while reading leg (d).
- **`openChannels` / `openInventory` are not run.** The org chart here is read off the tree.
  Whether people should become first-class inventory rows is the open wall this deliberately
  does not answer — and note the shape's own limit: a person **no seat names** cannot appear.
- **Nothing forces the guard.** An action author who omits it gets the old gap back. That is why
  the obligation is written as a business rule with a red state rather than left as prose.
- **The board's seats are blocks in a registry**, the board's own *inline* seat model. A seat
  that runs in its own session is a `dispatcher({ type: "task" })`, and that arm is not
  exercised. Nothing in the parking drain depends on which arm it is, but nothing here proves it.
- **One person, one org, one board.** Who may call *which* action, and a user-scoped private
  workforce, are not exercised — both are open walls.
- **No model runs.** Nothing here is a judgement call: a roster hires or refuses, a row is parked
  or is not, a request is the row's principal or is not.
