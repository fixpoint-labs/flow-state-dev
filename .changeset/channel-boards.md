---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": patch
---

A `CHANNEL.md` can declare `boards:`, a list of local names for durable task ledgers the channel keeps. `boards` joins the closed list of declarable keys. A channel holding one answers `fileTask` and `readBoard`, and its `read` lists the board names it holds. The ledger id is minted from the channel (`<channelId>.<name>`) and never written in a record. Seats reach the same ledger with `channelBoard(channelId, name)` and grant a model all eight task tools over it with `channelBoardTaskTools(board)`. `hireWorkforce` takes `channelBoards` and warns for a board no hired seat declares (FIX-1385).

`@flow-state-dev/orchestration` exports `buildTaskToolsList` from the package root, for a consumer that declares the ledger itself rather than through `createTaskToolsCapability`.
