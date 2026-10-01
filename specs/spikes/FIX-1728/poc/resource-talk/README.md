# POC · resource-backed talk channel (FIX-1728)

Retained evidence for [`../../SPIKE.md`](../../SPIKE.md). It's throwaway, it isn't production
code, and nothing imports it. Knip ignores `specs/spikes/*/poc/**`, and no build, test or
lint run picks it up. The test runs only when `run.sh` copies it into
`packages/workforce/test` for one run, and the copy is removed afterwards.

## The question

Can a Chief-of-Staff-like seat create an org-discoverable project record at runtime and get a
talk session minted for it from a template, with the link explicit on both sides, using only
what L1 already offers? And what happens when a second person in the same org tries to reach
that session?

## What's real and what's a sketch

Real engine: `createFlowState`, its HTTP router, the session-create, action, request-status,
session-read, children and collection-read routes, route auth, the dispatch seam
(`dispatcher` with `{ key }` and `{ id }`), and the reactive-block dispatcher (`reactTo`).
Real workforce: the built-in `channelFlow` (R1) and `channelInstances` (R2).

Sketches of the L2 pieces the convention would generate:

- `projects`: an org-scoped collection (`projects/*`) whose rows hold the project's data,
  plus a `sessions` list (the resource's side of the link). It has `reactTo.created` bound to
  a cross-flow `dispatcher` that mints the talk session.
- `project-talk`: a talk kind whose session state holds only `resourceId`. It has an internal
  `bind` entry that writes `resourceId` and appends `{ sessionId, userId }` to the row.
- `cos`: the CoS stand-in. It has `createProject`, `joinProject`, and two probes
  (`deliverInto`, `mintBuiltinChannel`).

Identity comes from a verified header: one org (`lab`), two users (`alice`, `bob`).

## Run

```bash
pnpm install
bash specs/spikes/FIX-1728/poc/resource-talk/run.sh
```

## Legs and observed output

Observed on `1e51ab9fe` (origin/main, 2026-10-01): **3 passed (3)**.

```
[FIX-1728] P1 create: {"status":202,"settled":"completed"}
[FIX-1728] P1 resource.sessions: [{"sessionId":"dsx_d026…","userId":"alice"}]
[FIX-1728] P1 talk session (alice): {"status":200,"flowKind":"project-talk","userId":"alice","orgId":"lab","parentSessionId":"sess_…8d584273016a1","state":{"resourceId":"apollo"}}
[FIX-1728] P2 bob reads projects: [{"id":"apollo","title":"Apollo","status":"active","ownerUserId":"alice","sessions":[{"sessionId":"dsx_d026…","userId":"alice"}]}]
[FIX-1728] P3 bob → alice's talk session: {"read":404,…"Unknown session …","action":404,…"Unknown session …"}
[FIX-1728] P4 resource.sessions after bob joins: [{"sessionId":"dsx_d026…","userId":"alice"},{"sessionId":"dsx_87b1…","userId":"bob"}]
[FIX-1728] P5 about (alice): {"status":"completed","result":{"output":{"resourceId":"apollo","title":"Apollo"}}}
[FIX-1728] P5 about (bob):   {"status":"completed","result":{"output":{"resourceId":"apollo","title":"Apollo"}}}
[FIX-1728] P6 deliver into a talk session by id: {"alicesOwn":"completed","bobIntoAlices":"failed","error":{…"session-not-found — no session \"dsx_d026…\" is reachable from this request"}}
[FIX-1728] R1 children of alice's CoS session: {"status":200,"ids":["dsx_4995…"]}
[FIX-1728] R1 minted built-in channel session: {"flowKind":"channel","state":{}}
[FIX-1728] R1 post into minted built-in: {"settled":"failed",…"channel-not-bound: session \"dsx_4995…\" is not an open channel. …"}
[FIX-1728] R2 channelInstances refusal: "… declares `resourceId`, which a channel does not declare. A channel declares: `flow`, `description`, `members`, `boards`, `instructions`, `routing`, `boardActions`."
 ✓ test/zz-fix1728-resource-talk.poc.test.ts (3 tests) 224ms
      Tests  3 passed (3)
```

| Leg | Checks | Result |
|---|---|---|
| P1 | Creating the row mints a talk session through `reactTo.created`. The session carries `resourceId`, belongs to the creator, and is a child of the creator's CoS session. The row lists the session. | pass |
| P2 | Bob, in the same org, discovers the project through the collection-read route, from a session of his own. | pass |
| P3 | Bob can't reach Alice's talk session. Read and action both return 404 "Unknown session". | pass |
| P4 | `joinProject` mints Bob's own talk session, and the row lists both. | pass |
| P5 | Each talk session reads "what am I about" from the resource row, not from its own state. | pass |
| P6 | A `{ id }` dispatch into another person's talk session is refused (`session-not-found`). Into one's own, it's delivered. | pass |
| R1 | Red state, expected: the built-in `channel` kind minted the same way has empty state, and its post refuses `channel-not-bound`. | pass (asserts the refusal) |
| R2 | Red state, expected: `CHANNEL.md` refuses a `resourceId` key (closed key list). | pass (asserts the refusal) |

## Control

`POC_NO_REACT=1` drops the `reactTo` binding from the collection. P1 must go red.

```
POC_NO_REACT=1 bash specs/spikes/FIX-1728/poc/resource-talk/run.sh
   × … P1–P5 … → "apollo" never listed 1 session(s)
   ✓ … R1 …
   ✓ … R2 …
      Tests  1 failed | 2 passed (3)
```

So the mint really comes from the reactive binding. Nothing else in the test creates the
session.

## Limits

- The talk kind is a sketch. A real one is the built-in channel kind plus a `bind` entry (see
  the spike's "Spec language to fold").
- `bind` appends to the row with `updateState`. This POC didn't test two concurrent joins on
  one row.
- Reactions fire only for writes made inside a flow turn. A row written outside a turn (a
  direct store write, a client content edit) mints nothing.
- In-memory stores, one process.
