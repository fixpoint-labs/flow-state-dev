---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/client": minor
"@flow-state-dev/devtool": minor
---

The DevTool header shows how much space the store takes ("DB 42.3 MB"), with the store kind and what was measured in its tooltip.

- **`StoreRegistry.storageSize()`**, optional: a store answers its own size as `{ kind, bytes, location? }` (`StorageSize`, from `@flow-state-dev/engine/host`). An adapter that leaves it out keeps compiling, and the readout stays hidden for it.
- **SQLite** counts the database file plus its `-wal` and `-shm` files; `location` is the file's path. A `:memory:` database offers no reading.
- **Filesystem** (`filesystemStores` / `createFilesystemStores`) counts every file under `rootDir`, attachments under `<rootDir>/blobs` included; `location` is the folder.
- **Postgres** sums `pg_total_relation_size` (table, indexes and TOAST) over the store's own tables only, never other tables in the same database; `location` is the database name, never the connection string.
- **In memory**: no reading, and the DevTool shows nothing rather than a number.
- **`GET /api/flows/debug/storage`** answers `200 { storage }` (`null` when the store can't measure itself). It sits behind the same debug gate as the other debug routes (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`, loopback or allow-listed origin) and the host's authentication. `client.debug.storage()` reads it (`DebugStorageResponse`).
- The DevTool reads it on open, when its tab regains focus, and once a minute.

Docs: apps/docs/docs/reference/stores.md (the optional `storageSize()` on a registry, what each built-in store counts), apps/docs/docs/reference/http-api.md (the `/api/flows/debug/storage` row under the debug routes), apps/docs/docs/reference/client.md (`client.debug.storage()`), apps/docs/docs/build/embed-the-devtool.md (the header's store-size readout and when it is hidden).
