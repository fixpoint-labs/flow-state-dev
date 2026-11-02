---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
---

`localWorkspaceHost({ setup: { command, env? } })` runs a setup command, such as `pnpm install`, in each new repository checkout before handing it over. It runs again on later provisions until it succeeds, and it counts against `provisionTimeoutMs`. `PlaceRequest.onSetup` is called when it starts, and `WorkspacePlace.setup` reports `done`, or `failed` with the tail of the output. A failure doesn't refuse the provision. In harness-manager, `WorkspaceConfig.setup` is passed through to the host, and task-board runs show the setup on their stream. The session flow's `provision(place, request)` may return `{ path, setup }` and pass `request.onSetup` to the host, and the turn record gains `setup` (FIX-2420).
