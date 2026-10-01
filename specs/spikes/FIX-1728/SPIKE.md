# FIX-1728 · Spike · resource-backed channel convention

**Status:** spike write-up, not for merge unless Jake chooses. **Evidence:** [`poc/resource-talk/`](poc/resource-talk/README.md),
run on `1e51ab9fe` (origin/main, 2026-10-01): 3 of 3 pass, and the control goes red.

## The answer

The pattern works on today's L1 with **no L1 change**. All the new code is Workforce (L2), and
it's small.

1. **The project is a row in an org collection.** The collection is declared once as a module
   in the existing `workforce/org/resources/` slot (`projects.ts`, ref `projects`): org scope,
   shared across flows, browser read with `expose`. CoS writes a row with `create()` at runtime,
   the way the hire block writes the hired roster today. Every user in the Lab's org can list
   the rows. Durable project data (title, status, owner, links) lives only on the row.
2. **The talk template is a `CHANNEL.md` with one new key**, `mintFor: projects`. A channel
   folder that carries it isn't opened at boot. It's a shape: `flow:`, `members:`, charter
   body. No new file name, and no list of rooms.
3. **The mint is a reaction, not a call.** At boot the binder puts `reactTo.created` on the
   `projects` collection: a cross-flow `dispatcher` to the template kind's internal `bind`
   entry, keyed on the row id. Creating the row mints the talk session in the same turn.
4. **The link is two fields.** The talk session's state holds `resourceId`, and the row holds
   `sessions: [{ sessionId, userId }]`. `bind` writes both. There's no third store.
5. **Talk sessions belong to one person.** The mint goes to whoever created the row. Anyone
   else who wants to talk about the project calls a `join` action that mints their own session
   and adds it to the row. Another person's session answers 404. The engine enforces this, and
   it's what Jake assumed.

The one built-in gap is in L2: today's channel kind can't be minted from a block, because it
needs `openChannels` to write its state at create (R1 below). The fix is an internal `bind`
entry on the channel kind and an optional `resourceId` on its session state. Both are
Workforce changes.

## Need your sign-off

Three forks. The hardest is first.

### 1 · When two people talk about one project, do they see each other's lines?

**In plain terms.** A talk session belongs to one person. If Alice and Bob both join "Apollo",
each gets a private thread with the project's seats. Bob can't read Alice's thread, and a post
in her thread can't be pushed into his. The engine refuses both (P3, P6). The project row is
the only thing they share.

**The trade-off.**

- **(A) Per-person threads.** Shared state is the row: status, owner, links, and later the
  board. Nothing to build in L1.
- **(B) A shared project thread kept on the resource.** Posts are stored as rows under the
  project in the org collection plane, and each person's session draws them. This is all L2,
  but it means you count the conversation as project data that lives on the resource.
- **(C) Sharing sessions between users.** That needs a new L1 grant or membership model across
  route auth and the action path, which is a security change.

**My recommendation:** (A) now. FIX-1650 already locks single-user first, so in v1 there's one
thread per project and the question doesn't come up. If you later want people to see each
other's lines, the upgrade is (B). (C) only after its own security spike.

**What would change my mind:** a v1 Lab with two or more real people who have to read one
thread.

**What being wrong costs:** with (A), moving to (B) later adds a thread collection, and
existing threads stay readable but private. Choosing (C) by default puts an L1 auth change on
FIX-1718's critical path.

### 2 · Ship this inside FIX-1650, or wait for the parked rooms work (FIX-1341)?

**In plain terms.** FIX-1650's D3 says that in this epic, channels are only declared and CoS
never opens one at runtime (ER-3). Minting a talk session when CoS creates a project is opening
one at runtime. FIX-1341 parked runtime "dynamic rooms" until Collab.

**The trade-off.** Shipping now means amending D3/ER-3 to allow exactly two runtime moves:
minting on create and joining. Retire, invite and rename stay out, and the slice is recorded as
the first instance of FIX-1341's dynamic-room lane. Waiting keeps D3 as it is, but FIX-1718 then
has no projects to show, because your direction makes projects runtime data.

**My recommendation:** ship the narrow slice inside FIX-1650 and amend D2, D3 and ER-3.

**What would change my mind:** if Collab is close enough that FIX-1718 can wait for it.

**What being wrong costs:** if Collab redesigns rooms, `bind` and `mintFor:` get renamed or
folded in. Stored data is only `resourceId` on sessions and `sessions` on rows, so the
migration is small.

### 3 · Where does a Lab author say "a new project gets a talk channel shaped like this"?

**In plain terms.** Somewhere in the tree has to say which channel shape a project gets.

**The trade-off.**

- **(a) One key on `CHANNEL.md`:** `mintFor: projects`. Authors already know the file, and the
  charter and members come for free. The cost is that a channel folder can now be a template
  instead of a room, and only the key tells you which.
- **(b) TypeScript only.** The `projects.ts` module wraps its collection in a helper. There's
  nothing new in the file grammar, but nothing a non-coder can edit either.
- **(c) A new file,** for example `TEMPLATE.md`. It reads clearly, but it adds a second file
  dialect for a shape `CHANNEL.md` already expresses.

**My recommendation:** (a). FIX-1650's D2 already says "at most a key is added to
`CHANNEL.md`'s closed list". The key's name is the implementer's to pick.

**What would change my mind:** if template and room folders get confused in practice. Then
(c), with the same fields.

**What being wrong costs:** renaming one key and moving one folder per template. Rows and
sessions are unaffected.

## Evidence

Run: `bash specs/spikes/FIX-1728/poc/resource-talk/run.sh` (full output in the
[POC README](poc/resource-talk/README.md)). Control: `POC_NO_REACT=1 …` gives
`"apollo" never listed 1 session(s)`, so the mint comes from the reaction.

### Q1 · Org resources: who writes, who reads, can a seat create at runtime?

- **Org scope is the axis.** An org collection's rows are shared by every flow in the org that
  declares the same definition with `flowIsolation: false`. A different org reads none. See
  `packages/workforce/src/roster/collections.ts:136-170` (hired roster) and
  `inventory/collections.ts:1-50`.
- **Reads resolve through the session's stored org**, which comes from the verified principal
  and never from the body: `packages/engine/src/resources/internal.ts:252`,
  `packages/engine/src/routes/session-routes.ts:370`. A browser read needs `client.state.read`
  plus `expose`, or the route returns 403 (`roster/collections.ts:153-166`).
  `cross-org-collection-read.test.ts` pins the org boundary.
- **Shift Manager reads them the same way**, through the collection-read route over a session:
  `labs/shift-manager/src/lib/reads.ts:211` (`inventory/seats/*`, `inventory/channels/*`).
- **A seat writes rows at runtime today.** The hire block does `roster.create(…)` at
  `packages/workforce/src/seat-hire-blocks.ts:229`.
- **Tree-declared org resources.** `workforce/org/resources/*.ts` modules may export a
  collection (`packages/workforce/src/resource-modules.ts:1-60`). That's where `projects.ts`
  goes, so no new folder is needed.
- **POC P1/P2.** Alice's CoS creates `apollo`, and Bob reads
  `[{"id":"apollo","title":"Apollo","status":"active","ownerUserId":"alice","sessions":[…]}]`
  from a session of his own. **Yes, every user in the org can discover it.**

### Q2 · Channels and sessions today; can code mint a talk session at runtime?

- **A channel is one named session on its kind**, and its id is literally the session id
  (`manifest.ts:143-149`). `openChannels` creates it through the session route, the only route
  that accepts caller state at create (`channel-binder.ts:784-866`). It writes members and
  charter once (`stateFor`, `:634`). On a 409 it leaves an already-bound channel as it was
  (`:837-841`): an edited `members:` or charter never reaches an open channel. Every channel
  belongs to one `userId` (`:178-183`). Kitchen-sink opens them all as one user
  (`apps/kitchen-sink/fsdev.config.ts:366,417-420`).
- **Sessions belong to the principal that created them.** On create, `userId` comes from the
  resolved principal (`session-routes.ts:300`) and the org from the principal (`:370`).
  Another user's session is answered 404 on reads (`route-auth.ts:527-537`). On actions,
  `UserBindingMismatchError` is thrown at `createExecutionContext.ts:749-751`, behind the same
  route-level 404 (POC P3: `{"read":404,"action":404}`).
- **A block can mint a session at runtime**, but only as a child: a `dispatcher` with
  `session: { key }` derives a child of the running session, minted on first use and adopted
  after. `{ id }` never creates (`packages/core/src/types/dispatch.ts:233-250`). The child
  belongs to the running request's principal. Workforce already does this for seat wakes
  (`wake-member-seats.ts:126-133`).
- **The trigger exists.** `reactTo.created` on a collection runs a block inside the turn that
  created the row (`packages/core/src/types/resource-change.ts:148-161`,
  `packages/engine/src/context/reactive-dispatch.ts:1-17`).
- **POC P1:** `{"flowKind":"project-talk","userId":"alice","orgId":"lab","parentSessionId":"sess_…","state":{"resourceId":"apollo"}}`.
  The owner is the person whose turn created the row: for CoS, the person talking to CoS. A row
  created by a non-human principal (a scheduled Linear import) mints a session for that
  principal, and people reach the project through `join`.
- **R1, the gap.** The built-in channel kind minted the same way has `state: {}`, and its post
  refuses with `channel-not-bound: … is not an open channel`. Its state can only be written by
  `openChannels` at create, and it has no internal entry that binds (`channel-flow.ts:1378,
  1431-1478`).

### Q3 · The minimal convention

The minimal convention is one new key on `CHANNEL.md` (fork 3). R2 shows the closed list refuses
anything new today:
`declares \`resourceId\`, which a channel does not declare. A channel declares: \`flow\`, \`description\`, \`members\`, \`boards\`, \`instructions\`, \`routing\`, \`boardActions\``
(`channel-binder.ts:81-89`). The key names a resource ref, not an id, so it lists no rooms.

### Q4 · The explicit link

- **Session side:** `resourceId` in the talk session's **state**, not `metadata`. Session
  metadata, `topic` and `coordinate` carry no authority by contract (`channel-flow.ts:80-82`,
  `packages/engine/src/stores/types.ts:84-110`), and the talk kind reads `resourceId` to find
  its project.
- **Resource side:** `sessions: [{ sessionId, userId }]` on the row, appended by `bind`. Both
  are written in one entry, so neither side can exist without the other. That's two fields and
  no join table.
- **POC P4/P5.** Both sessions are listed, and each one's `about` returns
  `{"resourceId":"apollo","title":"Apollo"}` read from the row.
- **Not covered:** concurrent appends to `sessions` (two joins at once) weren't exercised.

### Q5 · Isolation: can an org-level shared talk session exist?

**No. Not under any authenticated principal.** The code enforces it in three places: ownership
at create (`session-routes.ts:300`), a hidden 404 for another user's session
(`route-auth.ts:527-537`), and `UserBindingMismatchError` on the action path
(`createExecutionContext.ts:749-751`). Delivery into another person's session is refused too.
POC P6: `session-not-found — no session "…" is reachable from this request` for Bob, `completed`
for Alice. So fan-out from one person's thread into another's is closed as well.

Today's "shared" channels are shared only because each Lab authenticates everyone as one user:
kitchen-sink's `CHANNEL_OWNER` (`fsdev.config.ts:366`) and DevForce's single bearer principal
(`goals/devforce-lab/lab/host.mts:123-126`). An app with no resolver treats `body.userId` as
identity, which is impersonation, not sharing. Neither is a model to ship (invent-kill:
isolation off).

### Q6 · Is an L1 change needed?

**No.** The pattern uses `defineResourceCollection` (org scope, `client.state.read`, `reactTo`),
`dispatcher` with `{ key }` across flows, and session state. All of that ships. The changes are
all in Workforce:

- the channel kind gains an internal `bind` entry and an optional `resourceId` on its session
  state (nullable, default null; BP-023, BP-030);
- `CHANNEL.md` gains `mintFor:`;
- the binder attaches `reactTo.created` to the named collection and doesn't open template
  folders at boot;
- a `join` block.

If fork 1 goes to (C), that is the first L1 change, and the smallest generic hook would be a
session-access policy on the flow (`authorizeSession(principal, record)`) consulted at the three
sites above. Don't build it before that fork is decided.

## Spec language to fold

### FIX-1650 · DECISIONS · replace Q1 (answered) and amend D2, D3, ER-3

> **Q1 · answered (Jake, 2026-10-01) · A project is an org resource, and its talk channel is minted from a template.**
> A project is a row in an org-scoped collection declared once at `workforce/org/resources/projects.ts`
> (ref `projects`). The row is the only home of the project's durable data: title, status, owner,
> links, and the list of its talk sessions. CoS creates rows at runtime, and anyone in the Lab's
> org can list them. The conversation about a project happens in talk sessions minted from one
> template `CHANNEL.md` that declares `mintFor: projects`. Creating a row mints the creator's talk
> session in the same turn (a `reactTo.created` binding the binder installs). A person who wasn't
> the creator joins, which mints their own. The link is explicit and two-sided: `resourceId` in
> the talk session's state and `sessions: [{ sessionId, userId }]` on the row, written together
> by the kind's `bind` entry. Talk sessions belong to one person. No session is shared across
> users, and no project field lives in session state. Evidence: `specs/spikes/FIX-1728/`.

> **D2 · amended.** "A project record of its own" moves from *rejected* to *chosen*, as a row in
> the existing org resource plane, not a folder or a type. `workforce/projects/`, a `CHANNELS.md`,
> and an L1 Project or Workstream stay invent-killed. The `CHANNEL.md` key D2 allowed is
> `mintFor:`.

> **D3 · amended.** Channels declared in the tree stay boot-opened and unchanged. One runtime
> move is added: minting a talk session from a `mintFor:` template on resource create or join.
> Retire, invite and rename stay out (FIX-1341's dynamic-room lane, of which this is the first
> instance). **ER-3** becomes: "Retire, invite to, or rename a channel at runtime, or open one
> other than by a `mintFor:` template."

> **Open wall (carried):** a shared multi-person project thread (fork 1, option B) · boards per
> project (a template's `boards:` resolve to one ledger per template today, because
> `channelBoardId` derives from where the channel sits) · a workstream resource (owner session
> plus org-visible status row) on the same convention, a second `mintFor:` template over a
> `workstreams` collection, with no new substrate.

### FIX-1718 · rewrite of "Projects in Shift Manager"

> **PROJECTS lists the `projects` collection, not channels.** Shift Manager reads
> `projects/*` through the collection-read route on any session in the Lab's org, the same way it
> reads `inventory/*` today. Each project page shows the row (title, status, owner) and the
> viewer's own talk session, found by matching `userId` in the row's `sessions` list. A viewer
> with no entry sees **Join**, which calls the template kind's `join` and opens the session it
> returns. Another person's session never appears as a link, because it would answer 404.
> Workstreams no longer name a project with a `CHANNEL.md` key. Grouping workstreams under a
> project is a field on the project row (or a workstream row's `projectId`), decided here and not
> in the tree. Minted talk sessions are not registered in `inventory/channels/*`, so the Lab's
> channel list doesn't fill up with per-person threads.

> **Business rules to add.** A project row is written with `create()`, never `upsert()`, so a
> duplicate id is refused. A talk session already bound to one resource refuses `bind` for
> another. `bind` refuses a resource id with no row. A row created outside a flow turn mints no
> session, and its people reach it through `join`.

> **Implementer notes (not decisions).** The minted session is a child of the session whose turn
> created the row, and it outlives that session's deletion. Appends to `sessions` need a
> concurrency check, because two simultaneous joins weren't tested. The template kind is the
> built-in channel kind plus `bind`, so posts, wakes, routing and Soft B work unchanged.
