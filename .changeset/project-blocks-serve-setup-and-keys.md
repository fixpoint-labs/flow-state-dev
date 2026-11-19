---
"@flow-state-dev/workforce": minor
"@flow-state-dev/engine": patch
---

Every projects flow built from `defineProjectBlocks` now serves the project setup view and each user's connector keys route, and an app reads the organization and four collections it used to name by hand (FIX-2775).

- **workforce:** `defineProjectBlocks({ projectCoordinator })` takes the worker each user's project coordinator runs as. Its `views` always carry `projectSetup`, which answers `{ projectCoordinator }`, `null` when the option is absent, read with no session. A browser reads it with `projectSetupView` from `@flow-state-dev/workforce/browser` (`client.view(projectSetupView, {})` or `useView`).
- **workforce:** `defineProjectBlocks(...).connectorKeys` is the keys route as an inbound transport adapter: mount it with `createFlowState({ adapters: [projects.connectorKeys] })`. At `CONNECTOR_KEYS_PATH` (`/api/flows/mcp-credentials`), `GET` answers each server in `mcpServers` and when the caller set a key for it (`ConnectorKeyStatus[]`, never the key), `POST <path>/<server>` with `{ value }` sets one and `DELETE <path>/<server>` clears it. The caller is the user the projects flow's sign-in verifies; anyone else gets 401 before anything is read. A host that offers no servers serves no route. Keys stay under `mcp-credentials/<server>` in the user's scope. `connectorKeyStatuses(host, cell, servers)` reads the same answer on the server, for a host's own start line.
- **workforce:** `WorkforceClient.organization()` answers the organization the server acts in for the signed-in user, read once per client. A 401 or 403 rejection is a refusal.
- **workforce:** `@flow-state-dev/workforce/browser` exports `workerInventoryResource`, `projectsResource`, `privateProjectsResource` and `workerMessagesResource`, for `client.resource(def)` or `useResource(def)`, typed by what each collection's browser read publishes. It also exports `CONNECTOR_KEYS_PATH`, `ConnectorKeyStatus`, `ProjectSetup` and `ProjectSetupView`.
- **engine:** `PrincipalResolutionError` is exported from `@flow-state-dev/engine/host` too, for transport adapter authors.

Docs: packages/workforce/README.md (`organization()`; the four collection definitions on `/browser`; what `defineProjectBlocks` now serves: the `projectSetup` view with `projectCoordinator`, and the `connectorKeys` route with its path, answers and refusals), packages/engine/README.md (`PrincipalResolutionError` on `engine/host`, if the host entry lists its errors).
