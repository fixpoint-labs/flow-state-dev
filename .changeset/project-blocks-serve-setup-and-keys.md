---
"@flow-state-dev/workforce": minor
"@flow-state-dev/contracts": minor
---

Every projects flow built from `defineProjectBlocks` now serves the project setup view and each user's connector keys route, and an app reads the organization and four collections it used to name by hand (FIX-2775).

- **workforce:** `defineProjectBlocks({ projectCoordinator })` takes the worker each user's project coordinator runs as. Its `views` always carry `projectSetup`, which answers `{ projectCoordinator }`, `null` when the option is absent, read with no session. A browser reads it with `projectSetupView` from `@flow-state-dev/workforce/browser` (`client.view(projectSetupView, {})` or `useView`). Its answer's type is `ProjectSetup`, and the view's definition type is `ProjectSetupView`; both are on the root and on `/browser`.
- **workforce:** `defineProjectBlocks(...).connectorKeys` is the keys route as an inbound transport adapter: mount it with `createFlowState({ adapters: [projects.connectorKeys] })`. At `CONNECTOR_KEYS_PATH` (`/api/flows/mcp-credentials`, on the root and on `/browser`), `GET` answers each server in `mcpServers` and when the caller set a key for it (`ConnectorKeyStatus[]`, each `{ name, setAt }` with `setAt` `null` when unset; never the key), `POST <path>/<server>` with `{ value }` sets one and `DELETE <path>/<server>` clears it. The caller is the user the projects flow's sign-in verifies; anyone else gets 401 before anything is read. A host that offers no servers serves no route. Keys stay under `mcp-credentials/<server>` in the user's scope. `connectorKeyStatuses(host, cell, servers)`, on the root, reads the same answer on the server from the host's stores for one user's cell, for a host's own start line.
- **workforce:** `WorkforceClient.organization()` answers the organization the server acts in for the signed-in user, read once per client. A 401 or 403 rejection is a refusal.
- **workforce:** `@flow-state-dev/workforce/browser` exports `workerInventoryResource`, `projectsResource`, `privateProjectsResource` and `workerMessagesResource`, for `client.resource(def)` or `useResource(def)`, typed by what each collection's browser read publishes.

Docs: packages/workforce/README.md (`organization()`; the four collection definitions on `/browser`; what `defineProjectBlocks` now serves: the `projectSetup` view with `projectCoordinator`, `ProjectSetup` and `ProjectSetupView`, and the `connectorKeys` route with `CONNECTOR_KEYS_PATH`, `ConnectorKeyStatus`, `connectorKeyStatuses`, its answers and refusals).
- **workforce:** the connector keys route refuses a set or clear sent from another site (`sec-fetch-site: cross-site`, 403) and a set whose body isn't `application/json` (415), as the engine refuses every other browser write.
- **contracts:** `isJsonMediaType(contentType)` on `@flow-state-dev/contracts/helpers` says whether a content type's essence is `application/json`; the engine's JSON body rule and the keys route share it.
