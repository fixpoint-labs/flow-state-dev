---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A feature can ship as a kit, and an app installs several kits in one list, in any order (FIX-2626).

- **core:** `defineKit({ name, config, requires, slots, contributes, directory, install })` defines a kit and returns its factory; the app calls the factory with the kit's config, which is checked there. `slot.keyed(schema)` and `slot.list(schema)` declare the places other kits fill. A kit's `contributes({ config, slots })` fills the slots of the kits it requires, by slot key (`workforce.slots.workerFlows`), and sees its own slots already filled. `kit(config).without(slotKey, key?)` drops one kit's contribution, or one entry of it.
- **engine:** `createFlowState({ kits, fill, root })` installs kits in `requires` order, fills each slot once (a keyed slot takes a record, or entries keyed by their `id`; a list appends, the app's `fill` last) and serves each kit's flows beside `flows`, which is now optional. A list nobody can install throws at construction, naming every problem: a missing or circular requirement, a duplicate key (naming both kits), a fill by a kit that doesn't require the slot's owner. A kit's folder is read at start-up, and a file in it that the kit's reader didn't use stops the app starting, naming each file. A kit's default folder reads against `root` (the working directory unless given); a `directory` in a kit's config reads against the working directory. The new Node-only subpath `@flow-state-dev/engine/folder` carries the walk primitives a kit's folder reader uses.
- **workforce:** `classify`, `openRoot`, `openStructuralDirectory`, `refusedSymlink`, `unreadable`, `IGNORED_ENTRIES` and their types moved from `@flow-state-dev/workforce/loader` to `@flow-state-dev/engine/folder`, with no alias. Import them from there; `openRoot` now takes a second argument naming the folder (`openRoot(root, "workforce directory")`).

Docs: a new *Kits* page in Core → Fundamentals, after *Capabilities* (`defineKit`, `slot`, `requires`, `contributes`, `directory`, the `fill` and `root` options, one folder per kit and the used-or-refused rule); apps/docs/docs/api/server.md (`createFlowState`'s `kits`, `fill`, `root`; `flows` optional); packages/core/README.md (`defineKit`, `slot`); packages/engine/README.md (`kits`, `fill`, `root`, and the Node-only `@flow-state-dev/engine/folder` subpath); packages/workforce/README.md (the walk primitives row moves to the engine subpath).
