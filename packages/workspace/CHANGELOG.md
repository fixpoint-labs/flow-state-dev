# @flow-state-dev/workspace

## 0.0.0

- Initial release. The file projection between resource collections and
  wherever an agent works: `createProjection({ mounts, place })` hydrates
  mounted collections into a place and flushes them back, reporting an
  outcome for every path it reached. A path two writers touched comes back
  as a `conflict` carrying what the projection last committed, what the
  collection holds, and what the place holds — the three values needed to
  tell "I changed this" from "somebody else changed this". Ships
  `createHostPlace` (a real directory, contained, symlinks neither listed
  nor followed) and `createMemoryPlace` (a `Map`, for tests).
