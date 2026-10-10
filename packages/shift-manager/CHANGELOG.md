# @flow-state-dev/shift-manager

## 0.1.0

### Minor Changes

- 9590119: The Shift Coordinator is a coordinator: the DevTeam's chief of staff runs on the `coordinator` flow, routing by judgment, and hands work to its delegates. Its panel lists the conversation's delegates, adds one from your roster and removes one; a delegate's answer appears under the delegate's name, each routing decision as a quiet note beside the lines, and the chief of staff comes first on Roster (FIX-1791).
- fc2826f: Shift Manager has three themes, Day, Evening and Night, instead of light and dark: the mark in the sidebar changes the theme, `--shift` also takes `evening`, and with no pick the page opens on the theme the clock calls for (FIX-1800).
- 5d4306a: Roster lists the signed-in person's own workers beside the Lab's standard ones, read through Workforce's roster flow, and the chief of staff's conversation is a session of its flow that names the worker. A Lab registers the flows `hireWorkforce(installation)` returns (FIX-1788).

### Patch Changes

- 9b4e7b1: `defineCoordinatorFlow` now honours `agent.isolateUserState`: the coordinator flow keys its user-scoped storage by its copy when the judgment turn asks, as the `agent` flow does. Before, the option was accepted and ignored (FIX-1776).

  Shift Manager's DevTeam chief of staff carries the standard memory set (working memory, the rolling digest, `memory/recall`), read-side only unless `DEVTEAM_MEMORY_CAPTURE=1`. It says when it has no memory of something rather than inventing one.

- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- 195eaf4: Inbox shows the asks the signed-in person's own workers are waiting on them for, and those workers read as on call on Roster and in TEAMS. The snapshot reader reads the person's roster before it reads asks (FIX-1830).
- 9cc903f: Shift Manager is published: install `@flow-state-dev/shift-manager` and run `shift-manager --config ./fsdev.config.mts` to open a Workforce Lab in the browser on `fsdev dev --app`, with `--dev` to restart the Lab and reload the page on a save, and `--team`, `--devtool` and `--devtool-assets` removed in favor of `--config` (FIX-1770).
- fd21824: The sidebar's TEAMS lists the signed-in person's own workers beside the Lab's standard ones, read from their roster as Roster reads it, and its on-shift and on-call counts include them (FIX-1741).
- Updated dependencies [b75c1ed]
- Updated dependencies [a3bfbc2]
- Updated dependencies [f469423]
- Updated dependencies [211679a]
- Updated dependencies [bb1c224]
- Updated dependencies [204860e]
- Updated dependencies [7f892f6]
- Updated dependencies [9cc903f]
- Updated dependencies [83c48a7]
- Updated dependencies [a600325]
- Updated dependencies [e9f9316]
- Updated dependencies [82ec64e]
- Updated dependencies [7da156e]
- Updated dependencies [b808784]
- Updated dependencies [6a3ecf5]
- Updated dependencies [02ee032]
- Updated dependencies [65ddb90]
- Updated dependencies [97894aa]
- Updated dependencies [cd180d7]
- Updated dependencies [912ae98]
  - @flow-state-dev/fsdev@0.3.0
  - @flow-state-dev/devtool@0.3.0
