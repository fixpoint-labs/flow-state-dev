# FIX-1729 · Spike · shared project room

**Status:** spike write-up, not for merge unless Jake chooses. **Evidence:**
[`poc/shared-room/`](poc/shared-room/README.md), run on `1e51ab9fe` (origin/main,
2026-10-01): 3 of 3 pass, and both controls go red. Builds on FIX-1728 (PR #2629).

## The answer

**It isn't a big change if the room lives on the project, and it is if the room is a shared
session.**

- **Recommended: option B, a room stored on the project.** Each line of the conversation
  is a row in an org collection beside the project row. Every person keeps their own talk
  session (the FIX-1728 one), and it reads and writes that room. Who may read and post is
  the project row's `members` list, checked against the server's identity of the caller.
  **No L1 change.** Size **M, 3 PRs**, about one PR more than FIX-1728's per-person
  threads, which it replaces: a per-person thread is a room with one member.
- **A shared session (option A) is the big change.** One session that several users own
  breaks the "a session belongs to one person" rule. That rule is enforced in four places,
  and the "which requests belong to this session" filter that the snapshot and the session
  stream use is keyed on the owner at seven call sites. Size **L, 4 to 6 PRs**, including a
  security review of the auth surface. Nothing in it is needed for B.
- **Nothing better exists in the code today (C).** Org scope is the only plane several users
  share. `ownerPrivate` is the only row-level read fence, and it fences rows to one owner, not
  to a member list. Generalizing it is a possible later upgrade to B, not a replacement.

What B costs, in plain terms:

1. **Other people's lines don't arrive live.** Your own post streams to you as today. Someone
   else's shows up the next time your view reads the room (on focus, on a timer, or after a
   wake). Each read is one small request in your own session.
2. **Each person talks to the project's seats in their own seat conversation.** A post wakes
   the seat under the poster, so Alice's and Bob's posts wake two seat sessions. Both answer
   into the one room, and each seat reads the room as its context, so neither misses the
   other's lines.
3. **The room is not the item log.** Today a channel's transcript is its `channel-post`
   items, in the one owner's session. A room's transcript is its rows. Channels and rooms
   would have two transcript homes until one is chosen for both.

## Need your sign-off

Three forks. The hardest is first.

### 1 · Build the shared room now, instead of per-person threads?

**In plain terms.** FIX-1728 gives each person their own private thread about a project. A
room gives everyone on the project one conversation. The plumbing is the same (the project
row, the mint, join, the two-way link). The room adds a member list and stores lines on the
project instead of in each person's session.

**The trade-off.** Building the room now costs about one more PR in FIX-1650. It also means a
"thread" never has to be migrated: one person alone in a room is a per-person thread. Building
per-person threads first is smaller now, but their lines live in private sessions, so moving
to a room later leaves the old lines private or needs a copy.

**My recommendation:** build the room now, as the only talk shape, and drop the per-person
thread from FIX-1650's plan.

**What would change my mind:** if FIX-1718 can't take one more PR before it ships, or v1 will
never have two real people in one Lab.

**What being wrong costs:** about one PR of work you didn't need, if rooms never get a second
member. The other way round, it costs a migration of thread history, or leaving it private.

### 2 · Who can read a project's room: its members, or everyone in the Lab?

**In plain terms.** Everyone in the Lab can already see that a project exists (FIX-1728). The
question is whether they can read the conversation too.

**The trade-off.**

- **(a) Members only, read through each person's session.** The POC does this. Each read is a
  request in the reader's session, so a view that refreshes often writes many small request
  records.
- **(b) Everyone in the Lab reads, and only members post.** The room's rows become readable
  through the existing collection route, which is a cheap page-by-cursor GET with no request
  record. Posting stays member-only.
- **(c) Members only, and cheap reads.** This needs a new L1 row fence, "readable by the users
  this row lists", alongside `ownerPrivate`. That fence has to be checked on every read path
  (the `owner-private.ts` header lists them: the resource handle, the request-start seed cache, projected collections, the browser routes, `/state` and debug).

**My recommendation:** (a) for v1, with views reading on focus and after a wake, not on a fast
timer. If a Lab never needs private projects, (b) is a one-line change to the collection.

**What would change my mind:** a Lab where people sit in a room all day waiting for lines. Then
(b), or (c) if the room must stay private.

**What being wrong costs:** with (a), extra request records and a few seconds of lag. With (b),
anyone in the Lab can read every project's conversation. With (c), an L1 security change on the
critical path.

### 3 · Do the project's seats get one conversation per room, or one per person per room?

**In plain terms.** When Alice posts, the seat (say, the PM) wakes in a conversation that
belongs to Alice. When Bob posts, it wakes in one that belongs to Bob. Both answer into the one
room. Engine isolation decides this (POC S5). One seat conversation for the whole room would
need it to belong to nobody in particular, which means a non-human owner for the room.

**The trade-off.** Per person works today, and a seat acts with the poster's authority, which
is the safe default. Its memory is split, so it has to read the room's recent lines as context
each time it wakes. One conversation per room gives the seat one memory, but it needs a
service identity that owns the room's seats, and that is close to "isolation off for rooms".

**My recommendation:** per person, with the room's recent lines given to the seat on every wake.

**What would change my mind:** if seats need long private reasoning about a project that the
room's lines don't carry. Then the seat should keep notes on the project row, not move to a
shared identity.

**What being wrong costs:** a seat answering without context it should have had, until its
room-lines context is wired. That's an L2 fix with no data migration.

## Evidence

Run: `bash specs/spikes/FIX-1729/poc/shared-room/run.sh`. Full output is in the
[POC README](poc/shared-room/README.md).

### The ownership rule, verified (why A is big)

The FIX-1728 findings hold on `1e51ab9fe`, and there are more sites than three:

| Where | What it enforces |
|---|---|
| `packages/engine/src/routes/session-routes.ts:300` | The owner of a new session is the resolved principal, never `body.userId`. |
| `packages/engine/src/routes/route-auth.ts:533-538` | Another user's session is answered 404 on every session-addressed route. |
| `packages/engine/src/routes/route-auth.ts:543-545` | Another user's **request** is answered 404 too. In a shared session, Bob's request would be his, so Alice couldn't stream it. |
| `packages/engine/src/context/createExecutionContext.ts:749-751` | Action path: `UserBindingMismatchError` when the caller isn't the session owner. |
| `packages/engine/src/context/binding-errors.ts:163-171` | `assertSessionAdmitted`, the same rule for `runAction` and the transport host (queued runs). |
| `packages/engine/src/context/create-request-host.ts:209-222` | A dispatch into an existing session: `session-not-found` unless the caller owns it. |
| `packages/engine/src/context/session-request-scope.ts:41-61` | "Requests in this session" means requests **by the session's owner**. Used at `session-routes.ts:544`, `state-routes.ts:109`, `session-stream-routes.ts:137,399`, `createExecutionContext.ts:664,2674`. |

So a shared session isn't one access hook. If route auth let Bob in, his posts would still be
missing from Alice's snapshot and session stream (`docs/architecture/streaming.md:240`: "It
shows only requests made in it under its owner"). Inside his turn, the engine would also have
to decide whose `user` scope a shared session sees.

**Option A, priced.** The smallest generic hook would be a flow-level
`authorizeSession(principal, sessionRecord) → "owner" | "participant" | "none"`, consulted at
every site above, with `sessionRequestScope` widened from "the owner's requests" to "requests by
any participant". Workforce would answer from the project row's `members`. That means changes
in route auth, the action path, the dispatch host, the request-scope filter and its seven call
sites, and request-level auth. It also needs `docs/architecture/authentication.md` rewritten
and adapter conformance tests for the stores' request filters. **L, 4 to 6 PRs**, and every
one is on the auth surface. It's also the one option whose authority comes from a hook that
apps write, so a wrong hook opens other people's sessions.

**POC RA (red, expected).** Bob is a member by the row and still gets
`{"read":404,"state":404,"stream":404,"post":404}` for the one room session.

### Option B, built (no L1 change)

**What changes.** All of it is Workforce (L2), on the FIX-1728 shape:

- `projects` row gains `members: string[]`, written only by trusted code (CoS at create, a
  later `invite` by a member). The joining caller never writes it.
- A new org collection `room-lines` (`pattern: "room-lines/*"`, `prefetchMode: "lazy"`, no
  `client` read), with one row per line: `{ projectId, seq, userId, author, body }`. `userId`
  is the poster's session owner, from the engine. `author` is a seat's label, or null.
- The talk kind (FIX-1728's `bind` kind) gains `post`, `read { after }` and `answer`, all
  gated on `members.includes(session owner)`.
- The binder's Soft B wake is unchanged in shape. It's keyed per room, under the poster.

**Security (BP-031).** The gate reads the caller from the session record, which the engine
wrote from the verified principal (`session-routes.ts:300`). It reads membership from the
org row. It never reads either from the body or from session state, because **session state is
caller-writable at create** (`session-routes.ts:337-343` accepts `body.state`). POC N1 shows
why that matters: Mallory creates a room view with `state: { resourceId: "apollo" }`, and it
lands. Only the row check refuses her (`"read":{"settled":"failed","error":"not-a-member"}`).
With the gate removed (`POC_NO_GATE=1`), she reads and posts. **This applies to FIX-1728 too:**
`resourceId` in session state proves nothing about access by itself.

The boundary is L2 code. Any flow in the org that declares `room-lines` can read it on the
server, the same as any org data. The browser can't, because the collection route refuses a
collection without `client.state.read` (`resource-routes.ts:465`, POC N1 `"direct":{"status":403}`).

**Streaming and resume per viewer.** Your own post streams to you on your request's SSE, with
its sequence numbers, as today. The room has its own order, `seq`, allocated per line. Each
viewer keeps a cursor and reads `after` it (POC S4: cursor 2 gives 3 and 4 only). There is no
cross-user push. Bob's session stream shows only Bob's requests, by the rule above, so Alice's
line reaches Bob when his view next reads. That's fork 2.

**Membership and unread.** `members` is on the row. Unread is `room seq − my cursor`. The
cursor is the viewer's own, not project data, so it goes in a user-scoped collection keyed by
project (BP-027 default sharing), not on the row and not in session state. Not built in the POC.

**Wakes (Soft B, FIX-1715).** A post wakes the project's seats through the existing
`wakeMemberSeats` shape. Its key is `channel:<channelId>` under the posting session
(`packages/workforce/src/channel/wake-member-seats.ts:132`), so one post gives one wake, never
one per viewer. POC S5 shows the cost: the seat sessions belong to the poster
(`underAlice: pm-seat/alice`, `underBob: pm-seat/bob`). The seat's answer goes into the room, so
everyone sees it (POC S3, S4). That's fork 3.

**The item log as the channel stream.** Today the channel transcript is the `channel-post`
items on the channel session's own requests (`channel-flow.ts:10-12`). That works because one
person owns all of them. The header admits this (`channel-flow.ts:18-23`: "every line of a
given channel is the SAME value"). A room can't use that, because items live in a session and
sessions don't cross users. So a room's stream is its rows. A post can still emit a
`channel-post` item in the poster's own session, so their own request stream and the devtool
look as they do today, but the rows are the room. That gives two transcript homes, channels in
items and rooms in rows. Flag it for `audit-coherence`, and pick one when channels next change.

**Concurrency of appends.** Lines are separate rows, each written with `create` (a duplicate
key is refused, never merged). Only the `seq` allocation contends. It's a CAS increment, and
the engine's driver retries three times with backoff (`packages/engine/src/stores/resource-cas.ts:92`).
With two people posting in parallel, that budget ran out and **a post was lost**
(`POC_NO_RETRY=1`: `concurrent_modification … "projects/apollo"`, 9 of 10 landed,
reproducible). With the room retrying the allocation itself, 10 of 10 landed, seqs 5..14
contiguous (C1). For the build: put the counter on its own row (`room-seq/<project>`) so
project edits don't contend with posts, retry in the room, and let readers tolerate a gap.

**Size.** M, 3 PRs:

1. Workforce: `members` on the project row, `room-lines`, the room kind's `post`, `read`,
   `answer` and `bind` with the gate, the seq row and retry, and the unread cursor collection.
2. Workforce: the binder's `mintFor:` (from FIX-1728), and the Soft B wake with the room's
   recent lines as seat context.
3. Shift Manager (FIX-1718): the room view (read by cursor, on focus and after a wake), unread,
   and Join/Invite.

### Option C: anything better in the code?

- **A shared scope?** No. Scopes are `session`, `user` and `org`
  (`packages/core/src/types/resource.ts:24`). Org is the only one several users share, and B
  already uses it. BP-027 is about sharing a user's own resources across flows, not across
  users.
- **`ownerPrivate` rows** (`packages/engine/src/resources/owner-private.ts:1-30`) are the one
  row-level read fence in L1. They fence a row to one owner, and every read path asks them. A
  sibling "readable by the users this row lists" would give fork 2's (c). It's an M-sized L1
  change on the same surfaces, and B doesn't need it.
- **A room owned by a service principal**, with the host relaying posts into it, makes the
  poster an unverified label again (today's `author`, `channel-flow.ts:20-23`). That's
  isolation off with extra steps. Rejected by the fences.

## Spec language to fold

### FIX-1650 · DECISIONS · amend the FIX-1728 Q1 answer

> **Q1 · answered (Jake, 2026-10-01) · A project's talk channel is one room, stored on the project.**
> A project is a row in the org collection `projects` (FIX-1728). The row lists the project's
> `members`, written only by trusted code: CoS at create, then a member's invite. The project's
> conversation is a room: an org collection `room-lines` with one row per line
> (`projectId`, `seq`, `userId` from the poster's session owner, a seat's `author`, `body`),
> ordered by a per-project sequence. Each person reaches the room through their own talk
> session, minted from the `mintFor: projects` template on create or join. That session reads and
> posts the room, and both are refused unless the session's owner is in `members`. Membership is
> never read from session state or a request body. No session is shared between users, and
> the room adds nothing to L1. Evidence: `specs/spikes/FIX-1729/`.

> **D2/D3/ER-3 as amended by FIX-1728, plus:** a talk session is a person's view of the
> project's room, not a private thread. One person alone in a room is the single-user case.

> **Open wall (carried):** live push of other people's lines (fork 2 (b) or (c)); one seat
> memory per room (fork 3); one transcript home for channels and rooms.

### FIX-1718 · "Projects in Shift Manager"

> **A project page shows its room.** The page reads the room through the viewer's own talk
> session (`read { after }`), on open, on focus and after a wake. It keeps the viewer's
> cursor in a user-scoped collection keyed by project, and shows unread as the room's last
> `seq` minus the cursor. A member with no talk session yet sees **Join**. A user who isn't a
> member sees the project's row and no conversation. Posting uses the viewer's own session. A
> post's seat answers appear in the room for every member.

> **Business rules to add.** Only a member reads or posts a room. The check uses the
> session owner against the row's `members`. A line's `userId` is the poster's session owner,
> never a field the caller sends. Lines are created and never edited. A seq allocated whose
> line was never written leaves a gap, and readers skip it. The seq counter is its own row, and
> the room retries the allocation after a lost race.

> **Implementer notes (not decisions).** A post wakes seats under the poster
> (`wakeMemberSeats`, keyed per room), so pass the room's recent lines as seat context. Read
> with `prefetchMode: "lazy"` and a key prefix, never load all lines. The engine's three CAS
> retries lost a post under a two-person burst (POC `POC_NO_RETRY=1`). FIX-1728's
> `resourceId` in session state is caller-writable at create, so gate on the row.
