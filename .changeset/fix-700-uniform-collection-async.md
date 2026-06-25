---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/tasks": minor
"@flow-state-dev/patterns": minor
---

Collection accessors are now uniformly async regardless of `prefetchMode`. `coll.get`, `coll.getOptional`, `coll.list`, and `coll.count` return Promises on both eager and lazy collections, so flipping a collection between eager and lazy no longer touches call sites or changes types — `prefetchMode` is a loading-cost knob only. Eager collections still resolve instantly from the in-memory cache; lazy collections may issue a store fetch. Single-resource `ref.state` stays synchronous; mutation methods were already async. The `EagerResourceCollectionRef` / `LazyResourceCollectionRef` interfaces and the mode generic on `ResourceCollectionRef` / `DefinedResourceCollection` are removed; update any read site to `await`.

`getOrCreateTaskCollection` is now async (returns `Promise<TaskCollectionRef>`) — await it. The resource-backed task collection hydrates a synchronous mirror at construction, so the returned `TaskCollectionRef`'s `get`/`list`/`count` queries stay synchronous. The task-board capability's `tasks()` accessor and its `factory` config option are now async (`() => Promise<TaskCollectionRef>`); await `ctx.cap.taskBoard_<name>.tasks()` before reading the board.
