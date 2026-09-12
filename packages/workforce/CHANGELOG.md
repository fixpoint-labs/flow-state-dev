# @flow-state-dev/workforce

## 0.2.0

### Minor Changes

- 33c8d10: New `hireWorkforce`: turn worker records into one configured flow copy each, with a worker's instructions handed to its flow as an `instructions` setting (FIX-1325).
- 2f74e07: Removed the Agent factory — `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported, so declare a worker as a `WORKER.md` record and hire it with `hireWorkforce`, and supply your own `agentRegistry`/`materializeAgent` to `createSkillsLibrary` for any skill that staffs a seat with `agent-ref` (FIX-1344).

### Patch Changes

- d195a90: When `readWorkforceDirectory` reports a worker folder that holds no `WORKER.md`, the error names the route for a worker whose behavior differs: define the flow in your app, pass it to `hireWorkforce` in `kinds`, and name it in that worker's `flow:` (FIX-1342).
- 119936d: New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
- 8a1173a: New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from more than one of those levels is refused, and its error entry carries every colliding path in `paths`; two teams may each carry the same name. Anything that should have reached the seat and did not lands in `errors`, each entry tagged with a `kind` naming which condition it is, so a caller can tolerate one class and refuse another without reading the message text (FIX-1356).
- Updated dependencies [a8e22c4]
- Updated dependencies [119936d]
- Updated dependencies [8a1173a]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.1.1

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
