---
"@flow-state-dev/workforce": minor
---

The `./loader` subpath publishes the walk every workforce-tree reader shares — `openRoot`, `walkTeams`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable` and `IGNORED_ENTRIES` — so a new convention calls the walk instead of copying it (FIX-1389).

Two changes existing code can trip over:

- **A symlinked workforce root is now refused by every reader.** `readWorkforceDirectory` and `readSeatSkills` followed the link and loaded the tree behind it; they now throw `Symlinked workforce directory "<root>" — refused for safety`, which `readChannelsDirectory` and `readResourcesDirectory` already did and all four readers' docs already promised. The refusal holds with a trailing separator or without, and in the published `classify` and `openStructuralDirectory` primitives as much as in the four readers. It does not reach a root named through a `.` segment, and nothing above the root is checked, so a path that passes through a symlink on its way in still reads. If you point a root at a symlink deliberately, pass the path it resolves to instead.
- **Every `readWorkforceDirectory` failure now carries a `kind`.** `ReadWorkforceDirectoryResult["errors"]` entries gain a required tag — `unreadable-slot`, `worker-load-failed` or `refused-declaration` — matching the other three readers, so a caller can tell the conditions apart without matching on `error.message`. Reading `errors` is unaffected; constructing the type (a mock, a fixture) now needs the tag.
