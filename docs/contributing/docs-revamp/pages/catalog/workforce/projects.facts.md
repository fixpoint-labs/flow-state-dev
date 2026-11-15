# Facts for Projects (K-10, catalog, kit sub-page)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (the labs and Shift Manager). No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. Every surface named here is built, so no fact is an approved spec's name marked for reconciling. The one non-citable file looked at is the vocabulary glossary the retired-terms check reads; it appears only in section 12 as a word rule, never as a fact.

Paths are from the repo root. Abbreviations:

- `pg` = `apps/docs/docs/workforce/projects.md` (the existing page; the plan's "workforce/projects" source)
- `og` = `apps/docs/guides/projects-on-org-scope.md` (the other source the plan names)
- `ov` = `apps/docs/docs/workforce/overview.md`
- `co` = `apps/docs/docs/workforce/coordinators.md`
- `mw` = `apps/docs/docs/workforce/messaging-workers.md`
- `cl` = `apps/docs/docs/resources/collections.md`
- `wf` = `packages/workforce/src`
- `pr` = `packages/workforce/src/projects`
- `wt` = `packages/workforce/test`
- `col` = `pr/collections.ts`
- `pw` = `pr/project-writes.ts`
- `ww` = `pr/workstream-writes.ts`
- `wc` = `pr/workstream-collections.ts`
- `we` = `pr/workstream-entry.ts`
- `pc` = `pr/project-coordinator.ts`
- `prd` = `pr/project-read.ts`
- `inst` = `wf/workers/installation.ts`
- `kit` = `wf/kit/workforce-kit.ts`
- `wcl` = `wf/workers/client.ts`
- `vis` = `wt/project-visibility.test.ts`
- `wst` = `wt/workstreams.test.ts`
- `pct` = `wt/project-coordinator.test.ts`
- `kt` = `wt/workforce-kit.test.ts`
- `ccs` = `labs/claude-code-style` (the one lab that serves a projects flow)
- `sm` = `packages/shift-manager` (the app that works projects through screens)

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/workforce`); the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the page plan (read first)

1. **Nothing in the kit serves projects; "install it" is two pieces of the app's own.** The workforce kit's `flows` slot header says "Workforce ships none of its own" (`kit:19-22`). A reader who adds `workforce({...})` has a roster, an agent and a coordinator flow but no flow that creates a project. To create one the app registers a flow of type `projects` (`PROJECTS_FLOW`, pinned: `pr/project-keys.ts:5-16`) whose actions are `defineProjectBlocks().actions` (`pg:85-89`; `ccs/flows/projects.mts:25-38`). To open a workstream it needs the installation, so it is built through the kit's `flows` slot: `fill: { [workforce.slots.flows]: { projects: (installation) => [...] } }` (`kt:145-160`, builder handed the installation, kit serves what it returns). The installable "Install it" step is therefore a config line (`projectCoordinator`) plus one flow, not a package or a copy. The plan's "kit template" has nothing to copy for this sub-page. Decision for the owner; the sheet states only what exists. **[page]**
2. **The existing page's quoted refusal text for another user's write is not what the engine throws.** `pg:304` and `cl:265` both quote "A record of an owner-writes collection is written only by the user it belongs to." The engine's constant is "A resource in an owner-writes collection is written only by the user it belongs to." (`packages/engine/src/resources/owner-private.ts:53`), and `wst:452-488` asserts the "A resource in …" text, three times. The page must not quote either; it can say "refused, and nothing changes". `cl:265` is another page's error; flagged. **[page: no quote]**
3. **"Workstream" is not shared-only.** The one-line definition that circulates says a workstream is "one area of a shared project". The code and test open a workstream on a private project, entry in the owner's user scope, session the owner's: `wst:215-237`, `wc:96-104` (private declaration), `ww:6-21`. Say "a project", as `ov:122` does. **[page]**
4. **"Everyone in the org can list it" holds for the collection read, not for the `listProjects` action.** A non-member in the org reads a shared project's record from the browser collection (`vis:56-71`, user `mallory` lists `apollo`). The `listProjects` action returns a shared record only to a member and a private record only to its owner (`prd:130-151`). The page says "read", and for "list" names which list. **[page]**
5. **Membership is fixed at create.** `members` is written once, by the creating call, as the creator plus the ids they name; no action in the package adds or removes a member afterwards. `pw:16-19` ("Nothing else writes `members`"), `col:85-88`, and the surface: the actions in `pw:195-213` and `ww:293-296` hold no member write. The existing page lists `members` in its row table (`pg:42`) and says nothing about changing it. State "set when the project is created" and nothing about how to change it. **[page, as a limit; verify no write exists outside `pr/`: grep of `wf/` for writes to `members` found only `pw:299`, `pw:354`]**
6. **Starting a coordinator checks that the user can read the project, not that they are a member.** `inst:715-763` reads the project record at the creator's own scope and refuses only when it is absent (404). It never calls `isMember`. Opening a workstream does (`ww:424-431`, `not-a-member`). So an org user who is not a member can start their own coordinator on a shared project and read it, and cannot open a workstream. No test names a non-member starting one (`pct` has `members: ["bob"]` only, `pct:198`). **[verify]** keep off the page, or say "a project you can read".
7. **The plan's Q3, "What does a workstream have exactly one of?" has more than one true answer.** One owner (named in the entry's key; `we:221-239`, `wc:14-19`). One lead, chosen at open, never changed (`we:201`, `ww:366-368`, `wst:301-320`). One session of that lead (`ww:16-22` header, `wst:175-198`, `wst:281-299`). One entry (`wc:6-12`). The page picks the answer the figure draws; every one is true and cited below (section 4). **[page]**
8. **The other plan source, `guides/projects-on-org-scope`, uses "project" for something else.** It is a recipe for an app-defined grouping on org scope: a `projects` collection and an `activeProjectId` in session state (`og:3-5`, `og:15-20`, `og:57-80`). It has nothing to do with the workforce project: no owner, members, workstreams or coordinator. The plan cuts it; the page must not borrow its examples, and the page can say in a clause that a project here is the workforce's. Its other content (organization ids, `resolvePrincipal`, `orgId` immutable) is not about projects. **[cut]**
9. **A project is not a folder; a run's checkout is.** Both are true in one product, so the page must keep them apart. The row is data (`col:7-9`, `pg:13`), its `repository` is a git remote never a path (`col:106-110`, `pg:581`), its files are rows (`col:238-257`), and a coding run's checkout is a folder on the host machine (`pg:613`, `pg:1000`). The checkout is K-14. **[page: first; second to K-14]**

## 1. What it is (opening)

- A project is a body of work: a title, a brief, an owner, and on a shared project the people working on it. `pg:13`, `col:89-136`. **[page]**
- It is data, not a file. "You don't write a folder or a file for one. It's a row created while the app runs, by your own code or by a worker acting for a user." `pg:13`; `col:7-9` ("A project is runtime data. It is created after the tree was read, so no file in the tree names it; the row is the project's one record."). **[page]** (answers Q1)
- Contrast the workers, which are files: `pg:13` says only "not a file"; the files are `WORKER.md` under `workforce/` (`ov`, `wf/loader`). One clause may say workers are files and projects are rows. **[page, one clause]**
- The work inside a project is split into workstreams. Each has one owner and a lead worker from that owner's roster. `pg:15`, `we:199-213`. **[page]**
- Everyone who can read the project can read every workstream's entry; only the owner changes their workstream or hands it work. `pg:15`, `pg:280`, `wc:14-19`, `wst:577-595`. **[page]**
- Each user talks to a project through their own project coordinator: a conversation with a coordinator worker that reads the whole project and hands work to that user's own workstreams. `pg:17`, `pc:1-36`. **[page]**
- A project id is one path segment, because it heads the keys under it (`col:289-298`). `unassigned` is reserved and refused (`col:51-54`, `col:291`). A segment holding `/` or `\`, `.` or `..` or an empty id is refused with `invalid-project-id`. `pw:268-269`, `pg:125`. **[ref]** (Reference has the refusals; the page may say "one word, lowercase slug" only if the code says so, and it does not: any one segment passes)
- It is the only "project" in the framework; the older guide's meaning is a different thing (flag 8). **[cut]**

## 2. Private and shared

### The two visibilities (Q: "Private and shared")

- You choose when you create. A create that names none makes a shared project. `col:56-60`, `pw:277`, `pw:69-73`, `pg:23`, `vis:56-71`. **[page]**
- **Shared:** lives in the organization. Everyone in the org can read its row (its repository included) and every workstream's entry. `col:189-197` (org scope, `client.state.read: true`), `pg:25`, `vis:56-71`. **[page]**
- **Private:** lives with its creator; nobody else can list, open or read it, its files included. `col:199-220` (user scope), `pg:27`, `vis:26-54`. **[page]**
- A private project shows only in the org you made it in. User scope is one cell per user per organization: `col:202-204`; test `vis:26-54` (Alice's private `elsewhere` in a second org is listed only there; her other org's list is empty). **[page, one clause]**
- Same kind of project, same fields; where it lives is its visibility, never a field on the row, so the two can't disagree. `col:11-19`, `pg:29`. **[page]** (the "never a field" mechanism part is **[cut]**)
- A private project can't become shared later, or the other way round. The surface has no action that moves a row, and visibility is the address, not a field: `col:11-19`, `pw:195-213` (the action list), `pg:29`. **[page, as a limit]**
- The owner is always a member. `members` on a shared project is the creator plus the other ids they name (`pw:299`, `vis:91-110` where `members: ["alice"]` was named). A private project has only its owner: `pw:354`, `col:99-103`. **[page]**
- A private create that names anyone besides its owner is refused `private-has-members`; naming only the owner is not "someone else" and passes. `pw:324-339`, `vis:73-89`. **[ref]**
- A shared create may name other members; they are the people who may open workstreams in it. `col:99-103`, `ww:424-431`, `wst:200-213`. **[page]**
- Members is the creator's own grant, written at create; nothing a member does adds to it (flag 5). `col:85-88`, `pw:16-19`. **[page, one clause: "set when it is created"]**

### Addressing (what two projects with one id look like)

- A project's address is its visibility and its id: `{ visibility: "shared", id: "apollo" }`. Every project read and write after the create takes one. `col:65-75`, `pg:31`. **[page]**
- Your private `apollo` and the org's shared `apollo` are two projects. `col:15-19`, `vis:91-110` (both created, each reached by its address, their owners and titles differ), `pg:31`. **[page]**
- Another user's private project can't be addressed at all: a call naming one is refused `no-such-project`, exactly as if it didn't exist. `pr/project-address.ts:376-387`, `vis:26-54` (Bob's `readProjectFiles`, `setRepository` on Alice's `notes` give `no-such-project`), `pg:31`. **[page]**
- The create writes a row and never overwrites. The same owner sending the same id again gets the existing row back with `created: false`; another owner's shared project holding the id is `project-id-held`. `pw:94-101`, `pw:281-290`, `pg:120-124`. **[ref]**

### What the other user cannot read (the figure's red marks)

- On a shared project the other member reads the row, every entry, and every report (the entry's content). They do not read: your workstream session (the lead's lasting session, its board and its tasks), your project coordinator conversation. `wst:577-595` (Bob reads Alice's entry and report from the browser; `GET sessions/<her session id>` is refused, `POST respond` on it is refused), `pct:283-292` (Bob posting to Alice's coordinator session is refused, http >= 400), `ww:6-21`. **[page: the figure's red marks]**
- A private project: nobody else reads the row, the entries, the reports or the files. `vis:26-54`, `wst:215-237` (Bob's entries list for Alice's private `notes` is empty), `wst:422-449` (Bob reads Alice's private-project report as `null`; a user in another org reads neither). **[page]**
- A project's files can be listed only by members, and neither files collection has a browser read (a request through the collection route gets 403). `col:238-257`, `pr/project-files.ts:51`, `pg:998`. **[ref]** (the page may say "files are for members only"; the 403 is Reference)

## 3. Workstreams

- A workstream is one area of a project with one owner. It is two things: an entry on the project, and its workstream session. `ww:6-21`, `wc:6-12`, `pg:185-188`, `ov:122`. **[page]**
- The **entry** holds: title, lead, session id, status, due date, objectives, opened-at, updated-at, and who wrote it last. Its latest report is the entry's content. `we:199-216`, `wc:69-79`. **[page: say "title, lead, status, due date, objectives, latest report"; the rest is ref]**
- The **workstream session**: a lasting session of the lead worker, owned by the workstream's owner; the lead runs the workstream through its delegates, so a lead must list delegates in its configuration. `ww:6-21`, `ww:396-405` (`cannot-lead` when it lists none), `pg:188`. **[page]**
- Opening a workstream makes both: the entry (owned by the caller) and then the lead's session, whose id is written onto the entry. `ww:6-21`, `ww:513-559`, `wst:175-198`. **[page]**
- **Who may open one:** on a shared project, only its members; on a private project, its owner. `ww:424-431` (`not-a-member`), `wst:200-213`. **[page]**
- **The lead** is a worker on the caller's own roster: their hired workers and the standard ones. Another user's worker, or no worker, is refused `no-such-worker`. `ww:262-264` (listLeads doc: "their own workers (one a hire made counts) and the standard ones"), `ww:432-434`, `wst:239-252`. **[page]**
- A lead must run on a lead flow and list delegates; otherwise `cannot-lead`. A flow lets its workers lead by declaring the internal entry `workstreamOpenedEntry()` under `onWorkstreamOpened`; the built-in `agent` flow declares it. `ww:396-405`, `pr/workstream-lead.ts:1-41`, `wf/agent-worker-flow.ts:1534`. **[page: one sentence; the entry name is ref]**
- **Exactly one of (Q3):**
  - One **owner**: the user whose session opened it. Named by the key `workstreams/<project>/~<owner>/<id>`, so the owner is read off the key, never the state. `we:221-239`, `wc:6-12`, `wst:175-198` (path `workstreams/apollo/~alice/checkout`). **[page]**
  - One **lead**, chosen at open and never changed: an open naming another lead for a workstream already open is refused `lead-differs`. `we:201`, `ww:366-368`, `ww:442`, `wst:301-320`, `pg:275`. **[page]**
  - One **session**, the lead's: two opens at once leave one entry and one session. `ww:6-21`, `wst:281-299` ("leaves one entry and one session when the owner opens one workstream twice at once"), `wst:175-198` (`sessionsWith("workstreamId", ...)` has length 1). **[page]**
  - A workstream is unique per project **and owner**: Alice's `checkout` and Bob's `checkout` are two workstreams. `we:228-239`, `wc:138-141`, `pg:264`. **[page]**
  - Opening it again hands the same entry back with `opened: false`. `ww:157-161`, `pg:264`, `wst:301-320`. **[ref]**
- **Who changes one:** only the owner writes an entry. The engine enforces this at the store, whichever flow writes (`ownerWrites` on the owner segment of the key). `wc:14-19`, `wc:81-91`, `wst:452-488` (Bob's write by flow code and by the app's action is refused and changes nothing; the same flow code run as Alice lands). Do not quote the refusal text (flag 2). **[page]**
- The lead keeps the entry current (status, due date, objectives, report) from its own session, as the owner, and cannot rename it. The title is the owner's, set by the owner or their project coordinator. `ww:48-57`, `ww:202-212` (`updateOwnWorkstreamInputSchema` has no title), `wst:490-560`. **[page]**
- `status` is a short label in the owner's own words, up to 80 characters. One label has a meaning: `"done"` finishes the workstream, which stays listed, is never stale and is never the next due date. New entries are `"on-track"`. `we:168-175`, `we:206`, `ww:485`, `pr/project-progress.ts:14-25`. **[page: the three clauses]**
- A workstream is never deleted: done is a status. `ww:57-59`, `wst:569-575`. **[page, as a limit]** (observable: no action in the package deletes one; a flow's own code could, the owner rule aside, but the surface offers none)
- Everyone who can read the project reads every entry; only the owner opens the workstream session, its board and its tasks. `wst:577-595` (`GET` on the owner's session by another user is refused; the entry's `sessionId` is exposed to the browser and "grants nothing to anyone but the owner": `wc:68`). **[page]**
- **The project reads** `readProject` returns the row, every entry oldest first, and progress (counts per status, objectives met of total, next due, entries unchanged for 7 days). Progress is worked out on each read and stored nowhere. `prd:85-99`, `pr/project-progress.ts:1-14`, `pg:317-348`. **[ref]**
- A project coordinator holds at most 25 delegates, one per open workstream of that user; the 26th open workstream in one project is refused `too-many-workstreams` (checked only when the installation names a project coordinator). Marking one `done` makes room. `ww:445-457`, `wf/delegates/delegate-keys.ts:24` (`MAX_DELEGATES = 25`), `pct:413-425`. **[ref]**

## 4. Talking to a project (Q2: whose worker answers each user)

- Each user talks to a project through their own **project coordinator**: a session of one standard coordinator worker the installation names, **one per user per project**. `pc:1-6`, `inst:119-126` (the option's doc), `pg:352`, `pct:269-281`. **[page]**
- Two users sharing `apollo` each get their own session of the same worker file; Bob's is not Alice's. `pct:283-292` (`his` is a different session, `userId: "bob"`; Bob posting to Alice's session is refused). **[page]** (answers Q2)
- The worker file is one, the sessions are many: the coordinator is a standard worker (a `WORKER.md`), the installation names it with `projectCoordinator`, and it must run on the `coordinator` flow or `createWorkerInstallation` throws. `inst:413-427`, `kit:104`, `kit:144`, `kit:265`, `pg:354`. **[page]**
- In the kit, the config key is `projectCoordinator` on `workforce({ ... })`; a string, one standard worker's id. `kit:103-104`, `kit:144`. **[page]**
- Without that option no session links to a project; a create naming one is refused. `inst:119-126`, `inst:719-722`. **[ref]**
- Only a session of the named worker can carry the project link; another worker is refused, naming the right one. `inst:723-728`, `pct:294-328`. **[ref]**
- You get yours with `ensureWorkerSession({ worker, projectId })`; the first call starts the session, every later call returns the same one. The id is derived from the user, the organization, the flow and the project, so two calls at once end on one session, and a session created by hand at an id of the caller's choosing is refused. `wcl:156-171`, `wcl:415-461`, `wf/workers/derive-session-id.ts:1-17`, `pct:269-281`, `pct:316-328`, `pg:389-401`. **[page: first-call-then-same; the derivation is cut]**
- It comes from `createWorkforceClient(fsd)` in `@flow-state-dev/workforce/browser`. `wf/browser.ts:21-28`, `pg:392-398`. **[page]**
- Starting one for a project you can't read is refused 404: another user's private project, a project nobody made, or a project in another organization's cell. `inst:737-763`, `pct:294-328` (404 with `no private project "notes"` for Bob; 404 for `nope`; 404 for `apollo` asked from the second org). **[page, one clause]** (membership is not the test: flag 6)
- The project's coordinator conversation is not one of the user's ordinary conversations with the coordinator worker: `listWorkerSessions(worker)` leaves it out, and the user's default conversation with that worker is a separate session. `wcl:172-181`, `wcl:462-476`, `pct:330-341`. **[page, one sentence]**
- **What it reads:** the project, every workstream's entry (other members' included, since shared means the org reads it), and the progress, through its `readProject` tool, which marks each workstream `yours: true` when the user owns it. `pc:31-36`, `pc:264-290`, `pct:564-600`. **[page]**
- To give it the tool, put `projectCoordinatorTools` in the catalog passed to `defineCoordinatorFlow` as `agent`, and list `readProject` in the worker file's `tools:`. `pc:292-300`, `wf/coordinator/coordinator-flow.ts:220-229` (`agent` is "the options the app gives the built-in `agent` flow, its tool catalog…"), `pg:364-387`. **[page, with the example]**
- **What it hands to whom:** when you ask it for work, it hands the request to the lead of one of your own workstreams, inside that workstream's session. It never hands work to another member's workstream: a task naming Bob's workstream by `target` is refused as an unknown assignee, and nothing is routed. `pc:31-36`, `pct:428-448` (Alice's ask is delivered once, into her workstream's session, with the answer back in her conversation), `pct:546-562` (Bob's workstream refused like a missing delegate). **[page]** (answers "whose worker answers": the coordinator answers the user; the lead of the user's own workstream does the work)
- A user with no workstream in the project has no delegate to hand work to; the coordinator still reads and answers. `pct:564-582`, `pg:403`. **[page, one clause]**
- Its delegates are the workstreams the user has open there, and follow them with no action from the user: opening adds one, marking `done` removes it, moving back out of `done` returns it. The delegate is the lead, with the workstream's address as its target. `pc:7-25`, `ww:20-35`, `pct:343-380`, `pg:405-412`. **[ref]** (the page may say "its delegates are your open workstreams")
- When a coordinator's own turn opens a workstream (its `openWorkstream` tool), the new workstream is already a delegate when the open returns, so it can hand the ask over in the same turn. `ww:30-35`, `pct:638-680`, `pg:461`. **[ref]**
- The coordinator may open workstreams, edit them, and change the project's brief and repository, when its catalog has the tools: `openWorkstreamTool`, `listLeadsTool`, `editWorkstreamTool`, `setBrief`, `setRepository`. A coordinator in a project opens and writes only that project; naming another is refused `other-project`. `pg:416-577`, `ww:243-297`, `pc:89-110`, `pct:703-722`. **[ref]**
- A user's own, non-project coordinator belongs to no project and must name the project. `pc:89-110`, `pg:223`. **[ref]**

### The example the page can carry (Examples line: creating a project, adding a workstream, opening its conversation)

All three calls are on an app with the wiring in flag 1. Each is drawn from the existing page, with its source checked against the code.

**Creating a project** (client call, action on the `projects` flow; `send(action, input, { sessionId })`): `pg:93-106`. Input shape: `createProjectInputSchema`, closed, `id` and `title` required, `brief`, `visibility`, `members`, `repository`, `mcpServers`, `checks` optional: `pw:61-89`. Output `{ project, visibility, created }`: `pw:94-101`, `vis:26-54` (`{ created: true, visibility: "private", project: { id: "notes", ownerUserId: "alice", members: ["alice"] } }`). The owner is whoever's session sent it, never a field: `pw:16-17`, `pw:62` ("Closed: nothing in it names the owner"). The session is a session of the `projects` flow: `fsd.flow("projects").createSession()` (`wf` client: `packages/client/src/client.ts:445`). **[page]**

```ts
await projects.send(
  "createProject",
  { id: "apollo", title: "Apollo", brief: "Ship the new checkout.", visibility: "shared", members: ["bob"] },
  { sessionId }
);
// -> { project: { id: "apollo", title: "Apollo", ownerUserId: "alice", members: ["alice", "bob"], ... }, visibility: "shared", created: true }
```

**Adding a workstream** (same flow, `openWorkstream` action from `defineWorkstreamBlocks({ installation, leadFlows })`): `pg:225-262`. Input: project address, `id`, `title`, `lead` (a worker on the caller's roster), optional `due` (`YYYY-MM-DD`) and `objectives` (strings). `ww:132-151`. Output `{ workstream: { project, id, owner, title, lead, sessionId, status: "on-track", due, objectives: [{ text, met: false, metAt: null, metBy: null }], openedAt, updatedAt, writtenBy }, opened: true }`: `ww:156-161`, `wst:175-198`. The lead must be a worker on a lead flow that lists delegates (section 3). **[page]**

```ts
await projects.send(
  "openWorkstream",
  { project: { visibility: "shared", id: "apollo" }, id: "checkout", title: "Checkout", lead: "eng-lead", due: "2026-11-30", objectives: ["Ship guest checkout"] },
  { sessionId }
);
```

**Opening its conversation** (the user's own project coordinator, then a message): `pg:389-401` for the ensure; sending is `await fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id })` as on `ov:185` and `co:106`. `ensureWorkerSession` returns the session summary with `id` and `flowKind`: `wcl:171`, `pct:269-281` (`record.flowKind` is `coordinator`). **[page]**

```ts
const workforce = createWorkforceClient(fsd);
const session = await workforce.ensureWorkerSession({
  worker: "project-coordinator",
  projectId: { visibility: "shared", id: "apollo" },
});
await fsd.flow(session.flowKind).send("respond", { message: "How is the project going?" }, { sessionId: session.id });
```

- `ov:185` and `pct:427-448` confirm `respond` is the coordinator flow's door. **[page]**
- The worker file that the example needs: `flow: coordinator`, `routing: judgment`, `tools: [readProject]` (`pg:376-387`; keys in `co:46`; `routing` default is `judgment`: `co:46`). **[page]**
- The page does not need to repeat the full wiring of `defineCoordinatorFlow`. If the kit config is shown, it is `workforce({ projectCoordinator: "project-coordinator", coordinator: { routeModel, agent: { catalog: { ...projectCoordinatorTools } } } })`: `kit:103-104`, `kit:144`, `kit:58` (`WorkforceCoordinatorOptions = Omit<CoordinatorFlowOptions, "installation" | "sessionFields">`), `wf/coordinator/coordinator-flow.ts:211-229` (`routeModel` required, `agent` the agent's options). **[verify: no test builds this exact kit config for a project coordinator; the pieces are each tested. Compile it in pass 4]**

## 5. Kit template items the page needs (what you get, install, slots)

- **What you get:** the project blocks (`createProject`, `setBrief`, `setRepository`, `setMcpServers`, `setChecks`, `readProject`, `listProjects`, `readProjectFiles`), the workstream blocks (`openWorkstream`, `updateWorkstream`, and tool forms), the two project collections, the two workstream-entry collections, the project files collections, the project coordinator tool `readProject`, and the browser helpers. `pw:195-213`, `ww:243-297`, `col:185-274`, `wc:96-110`, `pc:300`, `wf/browser.ts:52-80`. **[page: names only for the three or four the page uses; the rest to Reference]**
- **Install it** (flag 1): `projectCoordinator` on the kit config; one flow of type `projects` built through the kit's `flows` slot with the project and workstream blocks; a standard worker file on the `coordinator` flow; `projectCoordinatorTools` in the coordinator's catalog. `kit:103-104`, `kt:145-160`, `pg:354-387`. **[page]**
- **Slots it opens** (the workforce kit's, which this sub-page uses): `workerFlows` (keyed), `uses` (list), `flows` (keyed). `kit:176-180`, `kt:117-160`. The page only uses `flows`. **[page: `flows` only; others link]**
- **Slots it fills / views it serves:** the sub-page adds no slot of its own. The one view is the repository check, `checkRepository`, present on the projects flow only when the host gave `checkRepository` to `defineProjectBlocks` (`pw:195-219`, `pr/project-keys.ts:18-19`). It belongs to K-14 (a project's code). **[ref]**
- **Collections the project declares:** shared, `projects`; private, `privateProjects`; files, `project-files` and `privateProjectFiles`; entries, `workstreams` and `privateWorkstreams`. `col:41-48`, `pr/workstream-ref.ts:18-20`. Usually nothing is declared by hand: `hireWorkforce`'s roster flow, the project blocks and the coordinator flow declare them. `pg:49-73`. **[ref]**
- **Change it:** the brief (`setBrief`, members only; `null` clears it), the repository (K-14), the workstream's status/due/objectives/title. `pg:131-146`, `pw:371-392`, `pw:172-183`. **[page: brief, one example at most; rest ref]**

## 6. The four questions, for each stored part

For each: who owns it, who can see it, where it is stored, how many exist.

### The project record

- **Owner:** the user whose session sent the create, as the engine recorded it; `ownerUserId` on the row. Never an input. `pw:16-17`, `pw:273`, `col:97-98`. **[page]**
- **Who can see it:** shared: everyone in the organization reads the row from the browser, repository included (`col:189-197` `client.state.read: true` with every field exposed, `vis:56-71` where a non-member reads it); `listProjects` answers only members. Private: only the owner (`col:206-220`, `vis:26-54`). **[page]**
- **Where it is stored:** the app's store, at `projects/<id>`: shared at org scope, private at the owner's user scope (one cell per user per organization). `col:11-19`, `col:41-48`, `pr/project-keys.ts:5-8`. **[page: "the app's store, at org scope or the owner's user scope"]**
- **How many:** one row per id per visibility; a create never overwrites, so a second shared create of a held id is refused and the same owner's repeat returns the row. A user's private `apollo` and the org's shared `apollo` coexist. `pw:281-290`, `vis:91-110`. No limit on the number of projects. **[page]**

### The project's files (named only to say what the project is not)

- **Owner and who sees it:** shared, the project's members, through `readProjectFiles` only; private, the owner. `pr/project-files.ts:51`, `col:238-257`. No browser read. **[ref]**
- **Where:** `project-files/<projectId>/<path>`, org scope for shared and the owner's user scope for private; lazy. `col:238-274`, `pg:979-1000`. **[ref → K-14]**
- **How many:** one row per file; "a project's files grow without bound". `col:243-248`. **[ref → K-14]**

### A workstream entry

- **Owner:** the user the key names (`~<owner>` segment); the only writer. `we:221-239`, `wc:14-19`, `wst:452-488`. **[page]**
- **Who can see it:** everyone who can read the project: the org for a shared project, only the owner for a private one. Entries and reports (content) both. `wc:81-91` (`client.state.read`, `content.read`), `wst:577-595`, `wst:405-449`. **[page]**
- **Where it is stored:** the app's store at `workstreams/<project>/~<owner>/<id>`, org scope for shared, owner's user scope for private. `wc:6-12`, `wc:81-91`, `wst:175-198`. **[page]**
- **How many:** one per owner per workstream id per project; no entry is deleted; an owner may hold at most 25 open in a project when the installation names a project coordinator. `wc:138-141`, `ww:445-457`, `pct:413-425`. **[page: one per owner per id; 25 is ref]**

### A workstream session (the lead's lasting session)

- **Owner:** the workstream's owner (it is their session of the lead). `ww:6-21`, `wst:175-198` (`userId: "alice"`). **[page]**
- **Who can see it:** only the owner. Another user's `GET` and `respond` on it are refused. `wst:577-595`. **[page]**
- **Where it is stored:** the app's session store, a session on the lead's flow carrying the readonly state `workerId` and `workstreamId: "<visibility>/<project>/<id>"`. `ww:513-522`, `wst:175-198`, `inst:770-797` (the create check: the creator's own entry must exist, name this worker, name no other session). **[page: "the owner's session of the lead"; the state keys are ref]**
- **How many:** one per entry; two opens at once leave one. `wst:281-299`, `wst:322-358`, `inst:793-795`. **[page]**

### A project coordinator session

- **Owner:** the user. `pct:269-292`. **[page]**
- **Who can see it:** only that user. `pct:283-292`. **[page]**
- **Where it is stored:** the app's session store, a session of the coordinator flow, at an id derived from the user, organization, flow and project, with readonly state `workerId` and `projectId: "<visibility>/<id>"`. `wcl:415-461`, `pct:269-281`, `pc:1-6`. **[page: "one session per user per project"; derivation is cut]**
- **How many:** one per user per project, per organization. A private project's is separate from a shared project's with the same id. `pct:269-281` (`private/notes` has its own). **[page]**

### The coordinator's delegate list

- **Owner:** that coordinator session; written by the server only (workstream open and done), never by the user. `pc:7-25`. **[ref]**
- **Who:** the session's owner. **Where:** the coordinator session's own state. **How many:** one record per open workstream of that user; at most 25. `pc:7-25`, `pct:343-360`, `pct:413-425`. **[ref]**

## 7. What a workstream's address, a project's address and keys look like (for examples and the figure)

- Project address in an action: `{ visibility: "shared" | "private", id }`, strict. `col:65-75`. **[page]**
- A workstream's address in a task `target`: `<visibility>/<project>/<workstream>`, e.g. `shared/apollo/checkout`. `ww:244-256` (`workstreamRef`), `pr/workstream-ref.ts:51-55`, `pg:461`, `pct:428-436`. **[ref]**
- A coordinator session's readonly state: `projectId: "shared/apollo"`, `private/notes`. `pct:269-281`. **[ref]**

## 8. What the page must not claim (limits and non-facts)

- No page claim that a project can be deleted, renamed or have members changed: no such action exists (`pw:195-213`). Do not say it cannot, as a design choice; say what you can change. **[page: only what you can change]**
- A project's `status` (new rows `"active"`) is a free label with no write of its own in the package; keep it off the page. `col:95`. **[verify: no action sets it]**
- A project's `title` can't be changed after create: the only row writes are `setBrief`, `setRepository`, `setMcpServers`, `setChecks`. `pw:195-213`. **[verify: no `setTitle`; say nothing]**
- A non-owner cannot rename a workstream. Only the owner (through `updateWorkstream`) or their project coordinator (`editWorkstream`) sets the title. `ww:48-57`, `pg:306`. **[ref]**
- The coordinator cannot hand work to another member's workstream; to get something from theirs, read their entry or ask them. `pg:403`, `pct:546-562`. **[page]**
- The sessions are not the user's "conversations" list: see section 4. **[page, one sentence]**

## 9. What is not in this page (belongs elsewhere)

- The row's fields, collections, refusal reasons, the progress object, the 25-delegate cap, `leadFit`, `readProject` shapes, the browser parser: **[ref] `reference/workforce`** (`pg:33-47`, `pg:117-129`, `pg:264-348`, `pg:520-526`).
- A project's code: `repository`, remotes, checkouts, coding runs, `projectWorkspace`, `setWorkProject`, `needsProject`, source tools, MCP servers, checks, the project's files: **K-14** (`pg:579-1000`).
- Opening workstreams from a coordinator, editing them from a coordinator, managing the brief and repository from a coordinator: **[ref]** (`pg:416-577`); the page may say in a sentence that the coordinator can do these once its catalog has the tools.
- The Shift Coordinator that starts projects: its page (`apps/docs/docs/workforce/shift-coordinator.md`); Shift Manager's Projects screen: the Shift Manager starter page (`sm/src/surfaces/Project.tsx:6-22`). Link only.

## 10. Where each piece sits in the figure ("A shared project")

The plan's figure: one project, two users, each reaching it through their own worker. Marks: box in a box, hatching, red on what the other user cannot read (`CANNOT READ`). Facts for drawing it (marks: `docs/contributing/user-docs-figures.md:42-49`):

- **Outer box: the project** (hatched, `OUTLIVES THE REQUEST`): the row and its entries are stored (`col:189-197`, `wc:81-91`). Box in a box: the entries are parts inside it. `col:89-136`.
- **Two users, Alice and Bob** (the page's example names; `bob` is a named member in `pg:101`, `wst:200-213`): each user has their own coordinator session (`pct:283-292`).
- **Inside the project box, two entries**: `checkout` (Alice's) and `billing` (Bob's); the entries' paths `workstreams/apollo/~alice/checkout` and `workstreams/apollo/~bob/billing`. `wst:175-198`, `pct:564-582` (`billing` is Bob's in the tests). Everyone in the org reads both rows. **[figure]**
- **Each entry's workstream session**, owner-only, outside the project box (red: the other user's `CANNOT READ`): Alice's session of `alice-lead` on `checkout`; Bob's on `billing`. `wst:577-595`. Hatched too: sessions are stored. `ww:6-21`.
- **Each user's coordinator conversation**, owner-only: a line from the user to their coordinator to the project (it reads every entry) and to their own workstream's lead (it hands work). `pc:31-36`, `pct:428-448`, `pct:546-562`.
- **Red marks:** Bob's reach into Alice's coordinator session (`pct:283-292`) and Bob's reach into Alice's workstream session (`wst:577-595`). Not red: reading the entry and the report (`wst:577-595`), which is a normal read.
- **The one claim, for the highlighter:** the two users share one project and each reaches it through their own coordinator, which hands work only to their own workstreams. `pc:31-36`.
- Hatching means stored (outlives the request); a coordinator session is stored. A dashed outline would mean "lasts one action run": nothing in this figure is one. `user-docs-figures.md:42-47`.

## 11. Everything else in the existing page the new page does not state

The existing page `pg` (1,000 lines) is the plan's source. It also covers: declaring the collections (`pg:49-73`), creating (refusal table `pg:120-129`, `setBrief` `pg:131-146`), default projects from app code (`pg:147-149`), giving the writes to a worker (`pg:151-181`), `defineWorkstreamBlocks` and `leadFit` (`pg:190-217`, `pg:463-475`), the open refusals table (`pg:264-276`), `updateWorkstream` and its fields (`pg:278-315`), `readProject` and progress (`pg:317-348`), delegates following workstreams (`pg:405-414`), opening / changing workstreams and managing the project from the coordinator (`pg:416-577`), and everything under "A project's code and files" (`pg:579-1000`: repository, coding runs, `setWorkProject`, files read tools, MCP servers, checks, checkouts, the project's own files). All of it is **[ref]** or **K-14**. Do not restate it on this page.

## 12. Words and names to avoid (for the page's author)

- Call the conversation "your project coordinator" or "the project's coordinator". Never "room" or "coordinator chat" (the retired-terms check retires both for this term).
- "Project" here is the workforce's, a row with an owner. Do not use "project" for an org-scoped grouping, an `activeProjectId`, or a folder (flag 8).
- "Member" is the project's: a user the record's `members` lists (not a coordinator's, not a team's).
- Do not call a workstream a "task", a "task session" or a "channel". A workstream has tasks on its board; it is not one.
- "Owner" of a project and "owner" of a workstream are two different users possibly; say whose.
- No tracker ids. The source comments carry some (`FIX-…`, `BR-…`); none go on the page.
- Model name in examples: `openai/gpt-6-luna` (as `pg:371`).
- Do not quote the engine's refusal sentence (flag 2). Do not repeat "deliberate", "by construction" or "load-bearing" from the source comments.

## Revisions (round 1)

Moved to R-25 (`reference/workforce`), and the page links it instead of stating them: the project address and visibility rules (section 2, Addressing: a private and a shared project with one id are two projects, another user's private project refused as `no-such-project`, visibility and members fixed at creation); the `createProject` fields and defaults (section 2: `visibility` shared by default, `members`, where each type is visible); the `openWorkstream` preconditions and order of effects (section 3: members only on a shared project, the lead on the caller's roster that lists delegates, entry then lead session then session id); the workstream refusals (section 3: a non-owner write refused with nothing changed, the lead fixed at open, a repeat open leaving one entry and one session); the `readProject` output and handoff rules (section 4: counts, `yours: true`, a task naming another user's workstream refused as an unknown assignee, the no-own-workstream case); the coordinator session's absence from the ordinary worker-session list and its 404 (section 4); the membership rule on `setBrief` and the coordinator tool list (section 5).

Kept on the page: the one-owner, one-lead, one-session idea; two users' `checkout` are two workstreams; one coordinator per user per project, private to them; the `setBrief` example (`null` clears the brief).

Wording changes: a workstream session is "a long-lived session of the lead, owned by the workstream's owner" (was "lasting session"); a private project "shows only in the one organization you made it in" if you belong to several; the repository is a git remote its coding runs work from (`col:106-110`); the view is the repository check, `checkRepository` (section 5); `catalog` is the tools a coordinator's config lets it choose from. "Project members" is the form the retired-terms check accepts for a project's members.

## Revisions (round 2)

`onWorkstreamOpened` is the internal entry a worker flow declares with `workstreamOpenedEntry()` so its workers can lead; opening a workstream dispatches it, which creates the lead's session (`pr/workstream-lead.ts:1-37`). The coordinator session is left out of `listWorkerSessions` (section 4). The one view is `checkRepository`, present only when the host passes a `checkRepository` option to `defineProjectBlocks` (`pw:154-159`). Wording only otherwise: "a session of the coordinator worker"; reference pointers kept at three places.

## Revisions (round 3)

The page no longer mentions the coordinator session's absence from `listWorkerSessions` (section 4); that stays on the Reference page. A private project shows only in the organization it was made in (user scope is one cell per user per organization, `vis:26-54`), so the sentence now names the private project. Membership wording: only the owner and the users named in `members` open workstreams on a shared project (`ww:424-431`).
