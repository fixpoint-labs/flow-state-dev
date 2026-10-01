# POC · one shared project room (FIX-1729)

Retained evidence for [`../../SPIKE.md`](../../SPIKE.md). It's throwaway, it isn't production
code, and nothing imports it. Knip ignores `specs/spikes/*/poc/**`, and no build, test or
lint run picks it up. The test runs only when `run.sh` copies it into
`packages/workforce/test` for one run, and the copy is removed afterwards. The harness is
copied from the FIX-1728 POC (`spike/FIX-1728`, `specs/spikes/FIX-1728/poc/resource-talk/`).

## The question

Can one project's talk channel be one room that several distinct users read and post in,
with per-user isolation left on? And is a shared session (option A) possible on today's
engine?

## What's real and what's a sketch

Real engine: `createFlowState`, its HTTP router, the session-create, action, request-status,
session-read, session-state, session-stream, children and collection-read routes, route
auth, the dispatch seam (`dispatcher` with `{ key }`), the reactive-block dispatcher
(`reactTo.created`) and the resource CAS driver. Identity comes from a verified header: one
org (`lab`), three users (`alice`, `bob`, `mallory`).

Sketches of the L2 pieces option B would add:

- `projects`: the FIX-1728 org collection, plus `members` (written by the creator) and
  `nextSeq` (the room's sequence counter).
- `room-lines`: an org collection with **one row per line**, keyed `<project>.<seq>`, lazy
  prefetch, and no browser read. This is the room.
- `project-room`: each user's own talk session on the room. `post` and `read` check the
  caller's server-derived user id against the row's `members`. `bind` (internal) is the
  FIX-1728 bind with the same check.
- `pm-seat`: a seat stand-in. A post wakes it the Soft B way (a dispatcher keyed on the
  room), and it appends its answer to the room.
- `cos`: `createProject` (with members) and `joinProject`.

## Run

```bash
pnpm install
bash specs/spikes/FIX-1729/poc/shared-room/run.sh
```

## Legs and observed output

Observed on `1e51ab9fe` (origin/main, 2026-10-01): **3 passed (3)**.

```
[FIX-1729] S1 project as bob lists it: [{"id":"apollo","title":"Apollo","ownerUserId":"alice","members":["alice","bob"]}]
[FIX-1729] S2 room views: {"aliceRoom":"dsx_efe1d689","bobRoom":"dsx_feab2e68","distinct":true}
[FIX-1729] S3 bob reads (after 0): ["1:alice:kickoff: ship the brief by Friday","2:alice/pm:pm: noted line 1"]
[FIX-1729] S4 alice reads (after cursor): {"cursor":2,"lines":["3:bob:on it — draft tonight","4:bob/pm:pm: noted line 3"],"nextCursor":4}
[FIX-1729] S5 seat sessions woken: {"underAlice":[{"flowKind":"pm-seat","userId":"alice"}],"underBob":[{"flowKind":"pm-seat","userId":"bob"}]}
[FIX-1729] C1 post outcomes (not completed): []
[FIX-1729] C1 parallel burst: {"before":4,"seqs":[5,6,7,8,9,10,11,12,13,14],"bodies":["a0","a1","a2","a3","a4","b0","b1","b2","b3","b4"]}
[FIX-1729] N1 mallory: {"join":{"request":"completed","mintedChildState":[{"resourceId":null}]},"forgedState":{"resourceId":"apollo"},"read":{"settled":"failed","error":"not-a-member"},"post":{"settled":"failed","error":"not-a-member"},"direct":{"status":403,"body":{"error":"State read not permitted for \"room-lines\""}},"intoAlices":404}
[FIX-1729] N1 room as alice sees it: ["1:alice:secret plan"]
[FIX-1729] RA bob → the one room session: {"read":404,"state":404,"stream":404,"post":404,"body":{"error":"Unknown session \"dsx_9fab…\""}}
 ✓ test/zz-fix1729-shared-room.poc.test.ts (3 tests) 744ms
      Tests  3 passed (3)
```

Line format: `seq:userId[/seat]:body`. `userId` is the poster's session owner, never a body
field.

| Leg | Checks | Result |
|---|---|---|
| S1 | Alice creates `apollo` with Bob as a member. Her room view is minted by the reaction. Bob lists the project. | pass |
| S2 | Bob joins and gets his **own** room view (a different session). | pass |
| S3 | Alice posts. Bob reads it from his own session, followed by the seat's answer. | pass |
| S4 | Bob replies. Alice reads from her cursor (`after: 2`) and gets only the new lines. | pass |
| S5 | Each post woke the seat in a session owned by the **poster**: one seat conversation per (person, room). | pass |
| C1 | Alice and Bob each post 5 lines in parallel. All 10 land, with seqs 5..14, unique and contiguous. | pass |
| N1 | Mallory, same org, not a member. Her join binds nothing. A room view she forges with `state: { resourceId: "apollo" }` is created (session state is caller-written), but `read` and `post` refuse `not-a-member`. The collection route gives 403. Alice's view gives 404. The room holds only Alice's line. | pass |
| RA | Red for option A, expected: Bob **is** a member by the row, and still gets 404 on read, state, stream and post for the one room session. | pass (asserts the refusal) |

## Controls

**`POC_NO_GATE=1`** removes the membership check. N1 goes red: the join binds Mallory and her
forged view reads and posts.

```
POC_NO_GATE=1 bash specs/spikes/FIX-1729/poc/shared-room/run.sh
[FIX-1729] N1 mallory: {"join":{"request":"completed","mintedChildState":[{"resourceId":"apollo"}]},"forgedState":{"resourceId":"apollo"},"read":{"settled":"completed","lines":1},"post":{"settled":"completed"},…}
   × … N1 … → expected false to be true
      Tests  1 failed | 2 passed (3)
```

So the boundary is the L2 gate, and nothing else in the engine supplies it for org data.

**`POC_NO_RETRY=1`** takes out the room's own retry around the seq allocation. C1 goes red,
reproducibly: one of ten posts is lost after the engine's three CAS retries.

```
POC_NO_RETRY=1 bash specs/spikes/FIX-1729/poc/shared-room/run.sh
[FIX-1729] C1 post outcomes (not completed): [{"body":"b0","settled":"failed","http":202,"error":{"code":"concurrent_modification","message":"Resource \"projects/apollo\" update failed due to concurrent modifications"}}]
[FIX-1729] C1 parallel burst: {"before":4,"seqs":[5,6,7,8,9,10,11,12,13],…}
   × … S1–S5 … → expected 9 to be 10
      Tests  1 failed | 2 passed (3)
```

## Limits

- In-memory stores, one process. The burst is two users, not twenty.
- Nothing is pushed live to the other viewer. Each reads with a cursor (`read { after }`), and
  every read is one request in the reader's own session.
- The seq counter lives on the project row, so any edit to the row contends with posts. A
  real build puts it on its own row (see SPIKE.md).
- A seq allocated but whose line write then fails leaves a gap. Readers page by "after seq"
  and tolerate gaps.
- No unread count, no membership removal, no item emitted into the poster's own session.
