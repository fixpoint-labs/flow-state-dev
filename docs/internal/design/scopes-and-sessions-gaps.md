# Scopes and Sessions: Gaps to Today

This is the refactor material for [Scopes and Sessions: How It Should Work](scopes-and-sessions.md). The concept doc is the model; this file is the backlog: where today's code differs, which terms go, and what the change removes. Every "today" claim was read from the code at `main` and cites its file.

## Where today's code differs

| Target | Today |
| -- | -- |
| A block can read or write another session's copy by naming it, within one user | A block resolves only its own session's storage key, or its lineage root for resources marked shared to lineage (`packages/engine/src/context/createExecutionContext.ts:1543-1546`). The only general cross-session API for blocks, where the block chooses the session, returns a session's flow, its readable state fields, its history and lists. It reaches no resources (`packages/core/src/types/request-host.ts:296-314, 488-516`). The one exception is narrow: a dispatched request can read and settle the single parent-board row it was started for, at a server-stamped address (`request-host.ts:554-572`) |
| A resource is registered once by name, and any flow reaches it | A resource is reachable only from a flow that declares it. Same-name clashes are checked across flows at user and org scope, but a lineage space can't see two flows' declarations, which is why a cross-flow child gets its own lineage (`packages/engine/src/context/create-request-host.ts:457-465`) |
| Blocks and the HTTP API follow the same rule | The HTTP routes already serve any of the user's own sessions after an owner check (`packages/engine/src/routes/route-utils.ts:250-262`). Blocks get less than a browser does |
| A child reads its parent's data by naming the parent | A same-flow child shares its parent's lineage. A cross-flow child roots its own, because the lineage space has no flow in its key and two flows' declarations would collide there (`packages/engine/src/context/create-request-host.ts:457-475`). Session state is never shared (`packages/core/src/types/resource.ts:254-256`) |
| A child doesn't need copies of its parent's values | Parent values are written into each child's state at birth, "however many hops down" (`packages/workforce/src/workers/session-fields.ts:12-19`) |
| A board is a per-session definition, registered once by name | The conversation board is one per-user collection, split per conversation by a partition function, with flow isolation forced off so another flow can reach it (`packages/workforce/src/conversation-board/ledger.ts:136-150`, `packages/orchestration/src/tasks/collection/define-task-collection.ts:237-246`, `packages/orchestration/src/tasks/collection/partition.ts:4-12`). The steps a worker files for itself sit in a second collection, split the same way (`packages/workforce/src/conversation-board/plan.ts:80-83`) |
| A task id finds its row through the session that holds it | A separate index finds which partition holds a task id (`packages/orchestration/src/tasks/collection/find-task-partitions.ts:1-20`) |
| A view across sessions is one query | Shift Manager reads the whole task store through the first session whose flow declares it, then regroups rows by conversation (`packages/shift-manager/src/lib/reads.ts:388-431`). The coding board looks up a session's lineage to recompute its partition (`packages/harness-manager/src/kit/coding-board.ts:95-118`). The Inbox view reads every conversation's tasks at once (`packages/workforce/src/workers/inbox-view.ts:1-35`) |
| Data about a user's work is kept per user, keyed by its subject | The coding run record was moved from lineage sharing to per-user scope after a new session read `run: null` for a finished job (`packages/harness-manager/src/run-record.ts:22-43`). Matches the target, reached the hard way |
| One session's lock lives in that session | A workstream session's routing lock is a per-user record keyed by session id, because two conversations' boards route to it (`packages/workforce/src/conversation-board/routed-session.ts:1-38`) |
| A child reads its parent's task row by naming the parent | A one-row read and settle of the parent's task exists on the request host, but the default host leaves the read unwired (`packages/core/src/types/request-host.ts:554-572`, `packages/engine/src/flowstate/createFlowState.ts:1069-1072`) |
| Session ids are never trusted beyond the owner check | Matches. The lineage space is a separate storage kind precisely because session ids are caller-chosen (`packages/engine/src/context/createExecutionContext.ts:1574-1587`) |
| Rows inside one shared copy can have per-row owners | Matches. Owner-private and owner-writes collections already do this (`packages/core/src/types/resource-collection.ts:75-94`) |


## Retired terms the refactor removes

Counts are files that mention the term today: package source, then `docs/` plus the docs site, then labs and apps.

| Retired term | Say instead | Where it lives today | Files |
| -- | -- | -- | -- |
| Lineage, `lineageId` | The parent's id; a session's own id | The session record, `resolveLineageId`, the lineage storage scope, dispatch and session birth | 65 / 13 / 0 |
| Shared to lineage, `sharedToLineage` | Name the parent and reach its copy | The option on per-session resources and task collections | 30 / 33 / 2 |
| Partition, `partitionBy` | A session's copy | Orchestration's partitioned task collections, the skills collection | 25 / 10 / 0 |
| Filing session, `filingSessionId` | The parent, or the session that filed it | Workforce session state, the conversation ledger's partition | 32 / 7 / 0 |
| Board above, `boardAboveOf` | The parent's board | Workforce conversation board | 9 / 0 / 0 |
| Routed session record | The workstream session's own state | Workforce `routed-session.ts` | 4 / 0 / 0 |
| Task chain record, `taskChain` | Depth and count read from the parent links | Workforce `chain.ts`, child state | 12 / 12 / 0 |
| Carrier session | A query across sessions | Shift Manager's cross-conversation board read (`carrier` in `reads.ts`) | 1 / 0 / 0 |

Flow isolation is not retired. A definition that isn't marked shared keeps it, so a flow's private per-user or per-org state stays out of other flows, and two instances of one flow keep separate copies. Only the case where it was forced off so another flow could reach a task board goes, because shared definitions now cover that.


## What else this simplifies, and how much it removes

Every item below exists today because a session couldn't reach another session's data. Each one goes, or shrinks to a plain read or write by name.

| Area | Today's workaround | What replaces it | Size today |
| -- | -- | -- | -- |
| Task boards | One per-user store split per conversation by a partition function, flow isolation forced off, and an index to find which partition holds a task | A per-session board, reached by name | `partition.ts` 206 and `find-task-partitions.ts` 60 lines, plus 52 `partitionBy` lines across packages |
| Lineage | A storage space shared by a parent and its same-flow children, its own storage kind, and the rules for when a child joins or starts one | Naming the parent | `lineage-scope.ts` 306 lines, and 244 lines in the engine that mention lineage |
| Copies at birth | Parent values (filing session, project, routing, chain) stamped into each child's state, and carried through message hops | Values fixed at filing, such as the project, ride on the task row; the rest are read from the parent by name | `session-fields.ts` 126 lines, the carried-hop parts of `hop.ts` (239), and `filingSessionId` in 78 lines |
| Board above | A helper that works out which board a task session's task sits on, from the filing session or, for a workstream's session, the conversation that routed the task | The task being worked names its board (`ctx.task.session`) | `board-above.ts` 26 and `filing-session.ts` 115 lines |
| Routed sessions | A per-user record that says which board's task is using a workstream's lead session (the long-running session a workstream's lead worker works in) | That session's own state, read and written by name | `routed-session.ts` 143 lines |
| Task chains | A per-user record counting depth and size under the top task, keyed by a hash of its partition | Depth and size read through parent links, or kept on the top task's own row | `chain.ts` 229 lines |
| Run records | Moved from lineage sharing to per-user scope after a new session couldn't find a finished run | Unchanged: it already sits per user, keyed by its subject. Only its history note goes | none |
| Cross-session views | Shift Manager's carrier read, the coding board recomputing a partition, the Inbox reading every conversation's tasks | One query across the user's sessions | about 45 lines in Shift Manager, about 20 in the coding board, and the ledger read in the Inbox view |
| Prefix reads | Stores scan the whole user scope and filter by an encoded prefix | Indexed key parts (rule 12) | the prefix query in each SQL store |

**What I estimate it removes.** Roughly 1,500 to 1,800 lines of package source: about 1,200 in files that go whole (`partition.ts`, `find-task-partitions.ts`, `lineage-scope.ts`, `session-fields.ts`, `board-above.ts`, `filing-session.ts`, `routed-session.ts`, `chain.ts`), plus 300 to 600 in the parts of other files that carry their values, which is the less certain number. That doesn't include tests. 75 test files touch lineage, partitions, filing-session values or chain records, and most of those tests exist only to prove a workaround holds. It also retires eight terms and three options: `sharedToLineage`, `partitionBy` and the partition-reading `readFor`, plus the places that force flow isolation off for task boards.

**What it doesn't count.** The task board cleanup that this unlocks is separate and bigger: one board per session instead of the delegation and plan stores, a parent link instead of three copies of it, and the rules that exist because of two stores (`plan.ts` alone is 526 lines). The estimate above covers only what the scope change removes by itself.

**What it adds.** A registry lookup, the `{ session }` option on every resource accessor with its owner check, indexed key parts in the two SQL stores, and one store query that reads a definition across a user's sessions. That's on the order of a few hundred lines, mostly in the engine.
