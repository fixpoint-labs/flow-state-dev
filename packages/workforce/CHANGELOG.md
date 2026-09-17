# @flow-state-dev/workforce

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
