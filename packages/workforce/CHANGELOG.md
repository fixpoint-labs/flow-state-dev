# @flow-state-dev/workforce

## 0.4.0

### Minor Changes

- 8297186: A channel `post` now keeps the line as one `channel-post` component item on the channel's session (`CHANNEL_POST_COMPONENT`), so a page can render the transcript from the session's items. The post resolves only once that item is stored, and fails if the write does. New posts no longer land in `state.transcript`; `read` returns the lines already there first, then the posted ones inside the session's history window (50 requests by default). A channel kind of your own keeps and reads its lines the same way with `emitChannelPostLine` and `readChannelPostLines`. A message sent to an `agent` seat's `run` is now kept as the caller's turn in that seat's conversation (FIX-1585).
- 98fa8da: `hiredSeatOwnerPin` now refuses a missing or empty organization id with the same error `registerHiredSeat` throws, instead of returning a pin with an empty `orgId` (FIX-1572).
- a3bfbc2: The seat, channel and membership inventory collections (`defineSeatInventoryCollection`, `defineChannelInventoryCollection`, `defineMembershipIndexCollection`) declare a browser read. A session on any flow that installs one can list its rows through the collection-state route, for that session's own organization only, with the row's named fields (`id`, `kind` for a seat; `id`, `kind`, `members`, `openedAt` for a channel; `seatId`, `channelId` for a membership) and nothing else. Every member of an organization can now list its registered seats, channels and memberships from the browser (FIX-1502).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- ecca6d0: A worker on the built-in `agent` kind with no `tools:` line can now call the tools of the capability presets its file picks under `capabilities:`, where before it got only their context. Write `tools: []` to keep the old reach; a worker that writes a `tools:` line is unchanged. For a worker with no line, the hired seat's `config.tools` is now absent rather than `[]`, and the worker is refused at startup if two presets it picks list different tools under one name (FIX-1459).
- b092e17: Every hired seat now carries its own id as the `seatId` setting (for a runtime-hired seat, its roster id, the one a channel's `members:` lists), a `WORKER.md` that sets `seatId:` is refused by name, and a worker kind whose settings schema is hand-written rather than built from `workerConfigSchema()` must admit `seatId` or it refuses at boot naming the key (FIX-1589).
- e9f9316: A worker can now hold packages, folders of a `PACKAGE.md` and a `blocks/` folder found in its own `packages/` folder or taken by name from its team's or the org's through `packages:`: the built-in `agent` kind adds their instructions to its prompt and, when the worker writes no `tools:` line, their blocks to its tools, with `readWorkforce` returning them on each record, `hireWorkforce` taking the generated `packageBlocks`, and a custom kind receiving them under `seatPackages` (FIX-1459).

### Patch Changes

- 7c533fc: The built-in `agent` kind now declares an internal `onChannelPost` entry, so a channel's notify block can dispatch a post to an agent seat and have it answer with the post as its turn (FIX-1590).
- 50b5273: The workforce discovery door now leaves out a stored roster row it cannot address, such as one an app's own hire action wrote under the development organization or one whose seat id starts with `~`, instead of dropping the organization's whole seat listing, and `reloadHiredSeats` now files a row stamped for another organization under the organization it was read from in `byOrg` as well as in the flat `problems` (FIX-1541).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- f704d4a: FIX-1594: `channelPostCapability` adds a `post-to-channel` tool a seat names in `tools:` to post into a channel it belongs to, under its own `seatId`.
- 536b1f0: `reloadHiredSeats` no longer rejects when a stored roster row cannot be addressed, such as a runtime hire made under the development organization or a seat id starting with `~`. That row is skipped and named in `problems`, and every other organization's seats still reload (FIX-1536).
- 3311cc2: `HIRED_ROSTER_BROWSER_PATTERN` and `HIRED_ROSTER_PRIVATE_PATTERN` are now exported from `@flow-state-dev/workforce` instead of `@flow-state-dev/core/types`, and `@flow-state-dev/core` no longer exports `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` or `isHiredRosterPrivateCollection` (FIX-1549).
- 24a0829: `reloadHiredSeats` also returns `byOrg`, one `{ orgId, seats, problems }` per organization passed in, so each organization's skipped seats can be reported to that organization alone (FIX-1477).
- 02120a2: Added `createSeatHireBlocks(options)`, returning the seat-hire sequence's `hire` and `fire` handlers with no model in front of them — the same two handlers `createSeatHireCapability` mounts as catalog tools, for a caller that wants to dispatch `hire` (or `fire`) directly from an action (FIX-1500).
- b823e03: `createSeatHireCapability` adds catalog `hire` and `fire` on the existing mint, and `createWorkforceCapability({ hiredRoster })` lets Discover list those runtime hires (FIX-1525, FIX-1526). Hire refuses to register a seat without an owner pin `{ orgId, userId? }` from the hire row's roster owner (FIX-1529 / F2-PLAN).
- 4f03fae: A seat hired through `createSeatHireCapability` now records the organization that hired it, so a copy of its roster row read under another organization is refused on reload instead of becoming that organization's seat. Rows written before this change still reload in the organization they are stored under (FIX-1542).
- b36a8a5: A hand-built worker manifest with `tools: undefined` is now treated as having no `tools:` line everywhere (FIX-1459). Before, every turn already granted it its picked presets' tools, but the startup check read it as a written line and skipped the clash refusal, so a preset tool-name clash surfaced mid-turn instead of at hire.
- ea0d0bf: Add `wakeMemberSeats(seats, { fallback? })`, a channel notify block that wakes each member whose hired seat declares `onChannelPost`, once per post, and never on a post with an `author` (FIX-1602).
- Updated dependencies [53b50f0]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [7d4c413]
- Updated dependencies [69a9e29]
- Updated dependencies [3311cc2]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [407964a]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/orchestration@0.3.1

## 0.3.0

### Minor Changes

- 0f812c9: Skills, seats and channels now answer the agent discovery door and a seat narrows what it sees with its worker file's `discover:` key (FIX-817) — **breaking:** `createWorkforceCapability` no longer accepts `agents` (pass `roster` and `inventory`) or `catalog` (pass it to `defineAgentWorkerFlow({ catalog })` instead), each now a type error naming its replacement.
- 8faf08e: A `CHANNEL.md` can declare `boards:`, durable task ledgers the channel holds, with `fileTask` and `readBoard` actions on the channel and a `channelBoard()` helper for the worker that drains them (FIX-1385).
- 17e9748: Workers can call custom tools written as files. A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes.

  Migration: a worker kind that hand-declares the admission contract instead of composing `workerConfigSchema()` must add the new `seatTools` key, or it refuses its roster at startup naming that key (FIX-1416).

- 3e43c96: A flow can now be registered and unregistered after the runtime is built — `FlowState.register(flow)` admits one instance and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs, and a flow registered this way is served from the next request onward without cancelling one already running (FIX-1475).

  A workforce hired at runtime now survives a restart: `defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole one back at boot as `{ seats, problems }` for the caller to register a seat at a time, and `seatAddress(orgId, seatId)` is the address a hired seat answers on (FIX-1475).

  Migration: `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served. An app whose `flows` record keys differ from its instance ids will read different values there than before.

- 1a3a009: A workforce root spelled with a `..` that steps back through an earlier segment — `/srv/app/current/../workforce`, where `current` is a release symlink — is now refused wherever a reader opens a root; pass the path it resolves to instead (FIX-1375).
- 8291951: `splitResourceModules` turns the generated `resourceModules` map into the two things a flow already takes (FIX-1388).

  ```ts
  const { capabilities, resources } = splitResourceModules(resourceModules);

  const agent = defineAgentWorkerFlow({ uses: capabilities /* ... */ });
  const flowResources = { ...resourcesFromDocs(documents), ...resources };
  ```

  A capability goes to the worker kind's `uses`, where the resources it declares for itself reach the flow; a plain resource or collection merges into the one resource map, under its own ref. Nothing is installed for you — spread both at your own call site. An entry that can be neither is refused, naming its ref.

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

- f7e98d9: A worker file can now name which of its kind's capabilities that seat wants, and which of their presets (FIX-1388).

  ```md
  ---
  description: Fields questions about how the desk is running this week.
  capabilities:
    research: [briefing]
  ---
  ```

  Read by the built-in `agent` kind. Selecting **adds** to what the kind installed; a seat that names nothing carries every installed capability's own defaults, exactly as before. The whole selection is validated when the roster is hired, so a typo is a refusal at boot rather than a failed turn — including a capability the kind does not carry, a preset the capability does not declare, a preset the app turned off at install, a preset on a capability with open config, and a preset whose surface has to exist before a request runs.

  `SeatCapabilitySelection` is exported as the parsed shape of that key.

- 8bfb08c: `fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

  **Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

  `renderWorkforceCode` takes the discovered modules as a second argument.

- c315362: A workforce tree can declare read-only documents in `references/` beside the writable ones in `resources/`. A reference's body is served from its file on every execution context rather than from a stored row, so editing the file is the edit; `writable`, `llmWritable`, `render` and `flowIsolation` are derived by the folder and refused in frontmatter. A seat reaches the references at or above its place in the tree — the org's, its own team's and its own folder's — with no install-side filter, narrowed further by a `references:` list in its `WORKER.md`. Installing references on a kind without also passing them to `hireWorkforce` as `references` is refused at hire, naming the option: the wall is derived against that catalog, so omitting it would leave every seat reaching every team's references with nothing to say so. `resources/` behaviour is unchanged. `clearShadowedReferences({ references, orgId, content, installedOn })` migrates a tree where a document was written before it moved — `installedOn` names the flow so the stored content is addressed where it actually lives rather than guessed at (FIX-1467).
- 68d836a: A `WORKER.md` can declare `resources:`, the documents that seat may touch — naming one grants read, `rw` grants write — and the app supplies its documents through a new `documents` option on `hireWorkforce` (FIX-1381).

  Migration: `resources` is now read by the hire step rather than passed on as a setting, so a worker kind that declared a `resources` setting of its own must rename that setting before upgrading — it no longer receives an authored value. A seat that declares no `resources:` key keeps the reach it has today.

- caffe1c: A team can say once what all its seats are told: an optional `TEAM.md` at `teams/<teamId>/` carries the team's `description` and, in its body, the instructions every seat on that team is given (FIX-1377).

  Two things a consumer can trip over:

  - **`readWorkforce`'s result grows two fields**, `teams` and `teamErrors`. Treat a non-empty `teamErrors` as fatal alongside `errors` and `skillErrors` — a team file that failed is a whole team's seats running without instructions someone wrote for them.
  - **A hired seat's settings bag can now carry `teamInstructions`.** Every kind that composes `workerConfigSchema()` already declared the key, so nothing new refuses; but a kind that reads its config exhaustively will see a key it did not see before, for seats whose team wrote a `TEAM.md`. It is absent — never empty — for every other seat, so a tree with no `TEAM.md` anywhere behaves exactly as it did.

  A seat's own instructions and its team's stay two separate settings and are never merged. On the built-in `agent` kind both go into the prompt, the team's first and the seat's own last. That order is fixed, and it is a position rather than a ranking: nothing in the prompt path resolves a contradiction between the two.

### Patch Changes

- 68fb69c: `openChannels` accepts an `orgId`, so a channel's session is opened under the org its documents are scoped to (FIX-1412).
- 0508765: `readDeclaredRoster(root)` on `@flow-state-dev/workforce/loader` reads a whole workforce tree in one call — workers, teams, documents and channels — and returns one flattened `problems` list, each entry tagged with the layer that reported it. Problems are collected rather than thrown, so the caller decides what is fatal. It throws on the `root` and nothing else: a path that cannot be read, a path that is a symlink, or one spelled with an interior `..` that steps back through an earlier segment (FIX-1405).
- 4cd4f13: `openInventory` fills the live workforce inventory at boot: one row per hired seat, and one per open channel written by that channel itself from its own session state. `channelInstances({ inventory: true })` builds the built-in channel kind carrying the writer, and `inventoryWriterActions(kind)` puts the same two actions on a hand-rolled channel kind (FIX-1405).
- d49f255: `defineSeatInventoryCollection()`, `defineChannelInventoryCollection()` and `defineMembershipIndexCollection()` declare the org-scoped resource collections for the live workforce inventory, addressed with `membershipKey` and `membershipPrefix` (FIX-1405).
- 0056b97: The hired roster and a channel board's ledger can now be read by a browser, so a UI can draw them without an action in between. Both are organization-scoped, so a read returns only the reading session's own organization's rows. Each publishes an explicit allowlist rather than the stored row: a roster row crosses as its seat id, flow kind and instructions, withholding the settings bag, and a board row crosses as `CHANNEL_BOARD_CLIENT_FIELDS`, withholding the claim, lease, retry ledger, write log and the task's own payloads (FIX-1477).
- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [218de72]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/orchestration@0.3.0
  - @flow-state-dev/core@0.2.0

## 0.2.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.2.0

### Minor Changes

- 3c15e14: Rename the channel kind factory from `createChannelFlow` to `defineChannelFlow` (FIX-1386).
- 33c8d10: New `hireWorkforce`: turn worker records into one configured flow copy each, with a worker's instructions handed to its flow as an `instructions` setting (FIX-1325).
- 23bc757: Each worker on a roster now holds its own skills, seeded from its own org, team and worker folders instead of one shared bucket — a catalog already seeded under the shared key is re-seeded under the worker's own and its old rows are left behind (FIX-1362).
- 2f74e07: Removed the Agent factory — `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported, so declare a worker as a `WORKER.md` record and hire it with `hireWorkforce`, and supply your own `agentRegistry`/`materializeAgent` to `createSkillsLibrary` for any skill that staffs a seat with `agent-ref` (FIX-1344).
- 70f787e: Hiring now hands every worker seat the same settings — its instructions and the skills its folders declared, plus a reserved `teamInstructions` key nothing populates yet — so a custom worker kind must accept them by composing the new `workerConfigSchema()` into its `configSchema`, or it refuses the whole roster at startup (FIX-1367).
- f9a3626: Ship a built-in worker kind, so a worker file that names no `flow:` hires instead of being refused (FIX-1363).

  `defineAgentWorkerFlow()` called with no arguments is that built-in; the same call with a tool catalog, skills or a default model builds the flow you register under `agent` to replace it for every seat. Its settings are `instructions`, `model`, `tools` and a switch for up-front skill matching (off by default). Tool names are resolved against the catalog your app supplies and refused at the hire, by name, when it carries no such key.

  Two behaviour changes on `hireWorkforce`: `kinds` is now optional, and a record with no `flow:` resolves to the built-in rather than refusing. A `flow:` that is present but empty or whitespace-only still refuses — only an absent key means the default — and every other refusal stands unchanged, with the unknown-kind message now listing `agent` among the kinds available.

- af6d6b9: A name anywhere in a workforce tree — team, worker, channel, document, kind or block — may no longer be one Windows reserves for a device (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`), since a tree holding one cannot be checked out on Windows whatever the extension (FIX-1357).
- d46fb72: The `./loader` subpath publishes the walk every workforce-tree reader shares — `openRoot`, `walkTeams`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable` and `IGNORED_ENTRIES` — so a new convention calls the walk instead of copying it (FIX-1389).

  Two changes existing code can trip over:

  - **A symlinked workforce root is now refused by every reader.** `readWorkforceDirectory` and `readSeatSkills` followed the link and loaded the tree behind it; they now throw `Symlinked workforce directory "<root>" — refused for safety`, which `readChannelsDirectory` and `readResourcesDirectory` already did and all four readers' docs already promised. The refusal holds with a trailing separator or without, and in the published `classify` and `openStructuralDirectory` primitives as much as in the four readers. It does not reach a root named through a `.` segment, and nothing above the root is checked, so a path that passes through a symlink on its way in still reads. If you point a root at a symlink deliberately, pass the path it resolves to instead.
  - **Every `readWorkforceDirectory` failure now carries a `kind`.** `ReadWorkforceDirectoryResult["errors"]` entries gain a required tag — `unreadable-slot`, `worker-load-failed` or `refused-declaration` — matching the other three readers, so a caller can tell the conditions apart without matching on `error.message`. Reading `errors` is unaffected; constructing the type (a mock, a fixture) now needs the tag.

### Patch Changes

- cee0c62: `defineAgentWorkerFlow` accepts three new optional options — `uses` for capabilities every worker carries, `afterAnswer` for a block that runs after the answer, and `isolateUserState` to give each worker its own storage — so an app can compose memory or any other capability into the built-in worker kind (FIX-1364).
- 8270f00: Add channels: a built-in `channel` flow kind, plus `channelInstances` and `openChannels` to register it and open one named session per channel record (FIX-1311).
- efd4981: Channels can be declared in files: `readChannelsDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads each `teams/<id>/channels/<name>/CHANNEL.md` into a `ChannelManifest` that `channelInstances` and `openChannels` already take, collecting per-path failures instead of throwing (FIX-1352).
- d195a90: When `readWorkforceDirectory` reports a worker folder that holds no `WORKER.md`, the error names the route for a worker whose behavior differs: define the flow in your app, pass it to `hireWorkforce` in `kinds`, and name it in that worker's `flow:` (FIX-1342).
- 2b728c2: Custom flow kinds and blocks now register from the file tree: `fsdev gen` walks `workforce/flows/workers/`, `workforce/flows/channels/` and `workforce/blocks/` and writes a committed module exporting the `kinds`, `channelKinds` and `blocks` maps that `hireWorkforce`, `channelInstances` and a task board already take, so adding one no longer needs a startup line (FIX-1357).
- bbecd2d: Read a worker's own `resources/` folder as a third document root (FIX-1368).

  `readResourcesDirectory` now walks `workers/<name>/resources/` under both `org/` and every team,
  alongside the org and team roots it already read. A document there is addressed by the folders above
  it — `teams/<teamId>/workers/<worker>/<name>`, or `workers/<worker>/<name>` for an organization-level
  worker — so two seats can each have a `runbook` without their authors agreeing on a name.

  The org and team roots are unchanged: same documents, same order, same errors. A worker folder's
  documents load whether or not the folder holds a `WORKER.md`, and a `workers/` level or worker folder
  that is symlinked or unreadable is reported under its own path with the existing `unreadable-slot`
  kind. No new error kind.

  A worker's folder is a namespace, not a visibility boundary. To give one seat a document of its own,
  put `flowIsolation: true` in that document's frontmatter: each seat then gets its own rows, and a
  sibling seat asking for the same document reads its own empty copy.

- 119936d: New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
- 7986a48: Documents can be declared in files: `readResourcesDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads `org/resources/<name>.md` and `teams/<id>/resources/<name>.md` into one record each, and `resourcesFromDocs(documents)` turns those records into the resource map you spread into `defineFlow({ resources })` (FIX-1354). A resource is a file rather than a folder, and where the file sits decides the document's scope and ref — so `scope`, `ref`, `stateSchema`, `default`, the content sources and a lazy `prefetchMode` are refused by name in frontmatter rather than quietly ignored.
- 8a1173a: New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from more than one of those levels is refused, and its error entry carries every colliding path in `paths`; two teams may each carry the same name. Anything that should have reached the seat and did not lands in `errors`, each entry tagged with a `kind` naming which condition it is, so a caller can tolerate one class and refuse another without reading the message text (FIX-1356).
- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
- Updated dependencies [23bc757]
- Updated dependencies [64b323e]
- Updated dependencies [119936d]
- Updated dependencies [c25ad3e]
- Updated dependencies [8a1173a]
- Updated dependencies [23ac6de]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.2.0

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [bea3a24]
- Updated dependencies [b484d86]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [0443742]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/orchestration@0.1.0
