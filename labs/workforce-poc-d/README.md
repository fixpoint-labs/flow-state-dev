# Workforce POC lab D — data seats → defineFlow

Throwaway lab. Proves the Atlas lock on **today's** APIs: yaml/json seats
under `teams/<teamId>/` (and `workers/` / `agents/`) become one `defineAgent`
plus one worker `defineFlow`, fed into the two registries that already exist.
Never a second registry. Never a Team / Channel / MessageBoard / Knowledge
type. Never a hot-dynamic kind after boot.

**Do not merge this as product API.** Findings go on
[`fsd/workforce/pocs`](https://github.com/fixpoint-labs/agent-mailbox/pull/12).

## Run

```bash
pnpm --filter @flow-state-dev/workforce-poc-d test
pnpm --filter @flow-state-dev/workforce-poc-d demo
```

The demo prints JSON: loaded seats, AgentRegistry names, FlowRegistry kinds,
the DM session, and the dispatch wake.

## What the lock is

1. **Tree** — `src/tree/teams/engineering/workers/clerk.yaml` is a seat.
   `workers/intake.json` is a second seat in the strawman folder. `roster.yaml`
   is metadata, not a Team object.
2. **Factory** — each seat emits `defineAgent` + `defineFlow({ kind: seat.name })`.
   Same worker flow shape as lab A (`talk`, `deliver`, internal `receive`).
3. **Boot** — `createAgentRegistry(agents)` and `createFlowState({ flows })`.
   Engine registers flows at construction
   (`packages/engine/src/flowstate/createFlowState.ts:324-327`). No third map.
4. **Live seat** — `create_session` opens the DM; `dispatcher({ id })` wakes it.

## Exists vs proposed

| Piece | Status | Where |
|---|---|---|
| `defineAgent` / `createAgentRegistry` | exists | `packages/workforce/src/define-agent.ts`, `agent-registry.ts:8` — in-memory `Agent[]` |
| `defineFlow` | exists | `@flow-state-dev/core` |
| `createFlowState({ flows })` → `FlowRegistry` | exists | `packages/engine/src/flowstate/createFlowState.ts:324-327` |
| `discoverFlows` | exists | `packages/cli/src/resolve-flow.ts:74` — `.ts`/`.js` modules that default-export a flow |
| `readSkillsDirectory` | exists | `packages/orchestration/src/skills/read-directory.ts:34` — `<name>/SKILL.md` only |
| `create_session` / `dispatcher({ id })` | exists | same doors as lab A |
| Worker factory that emits a flow | **proposed** | this lab + lab A — not a package export |
| Directory scan of `org/` · `teams/` · `workers/` into those two registries | **named gap** | atlas §16; this lab names the file:line |
| `loadWorkforce()` | **cut** | atlas: do not invent it. Lab-local walker is not that export |
| Second registry / TeamFlow / Knowledge type | **cut** | would be inventing substrate |
| Hot-dynamic kinds after boot | **cut** | a yaml written later is not a live kind |

## Gap (stop — do not invent)

There is **no L1 loader** that walks yaml/json seats into `AgentRegistry` and
`defineFlow`. The two scanners that exist do not see this tree:

```
packages/cli/src/resolve-flow.ts:175
  scanFlowsDir imports only .ts / .js FlowInstance modules
  discoverFlows({ flowDirs: [tree] }) → []

packages/orchestration/src/skills/read-directory.ts:34
  readSkillsDirectory walks <name>/SKILL.md only
  pointed at teams/ → no skills

packages/workforce/src/agent-registry.ts:8
  createAgentRegistry(agents: Agent[])
  in-memory array. No directory argument.
```

This lab does **not** ship `loadWorkforce()`. The walker in `src/load.ts` is
lab-local so the factory + boot half can run. A product scan, if one lands,
must call the two registries that exist. No auto-reg of Team / Channel /
MessageBoard types. Architect already named this gap on the atlas page — this
lab confirms it on the APIs.

`agents/` is scanned as the **same** catalog (`createAgentRegistry`), not a
sibling registry. Atlas still cuts shipping an `agents/` folder next to
`workers/`.

## What this is not

- Not lab A (factory from markdown folders / DM / group fan-out). This lab
  reuses the worker `defineFlow` shape; it does not re-prove N-session fan-out.
- Not lab B (reply-storm / claim).
- Not lab C (plan = board + content).
- No changeset. Private lab. The `@flow-state-dev/workforce` import is
  `defineAgent` + `createAgentRegistry` — today's Agent APIs, not a new package.
