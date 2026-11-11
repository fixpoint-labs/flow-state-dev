# Weekly review · 4–11 November 2026

Window: PRs opened on or after 2026-11-04, read on 2026-11-11. `main` at the start of the review was `8f4dd8f29`.

## Verdict

The week added net shape. Views, kits, one live read, and one path from an event into a session each landed as one job. The thing to act on is smaller and already on main: the composer still hands a page two representations of one file, and the attachment job is missing from the mechanism list, so two of its helpers are classified as harness steering.

## The week in numbers

| | |
|---|---|
| PRs opened | 308 |
| Merged | 280 |
| Still open | 11 |
| Closed without merging | 17 (counted, not reviewed) |
| Threads | 186, grouped by the first `FIX-` id in the title, otherwise one PR |
| On `main` since 2026-11-04 | +218,422 / −29,517 across 3,904 files, 1,750 commits |
| Sum of PR diffs | +238,435 / −39,560. Stacks are counted once per PR, so this is larger than the `main` delta |
| `export` declarations added in `packages/*/src` | +985 / −430, net +555. This counts every new export line, including ones that are not on a package root |
| Mechanism rows added against 4 Nov | `kit`, `kit-folder`, `view`, `routines`, `subscriptions` (none of those ids were in the file at `7f705bdde`) |
| Rows still needed | 1, `attachment` |

## In-flight map

Used on every finding. Linear was not reachable, so status is from GitHub and the retained specs. The set table in `specs/epics/FIX-2618/SPEC.md` still says Backlog for children whose specs have merged.

| Id | What it will change | State | Signal |
|---|---|---|---|
| FIX-2623 | Views replace flow reads and scope `client.derived` | Slices 1, 2, 3a, 3b merged. #5121 open is 4 of 5 (`derived` refused). Slice 5 (remove `reads`) not opened. `specs/issues/FIX-2623/SPEC.md` still requires it | Imminent |
| FIX-2624 | User and org resources read by scope. Writes go through `runBy` | Spec merged. #5111 and #5122 open, not on main | Imminent |
| FIX-2625 | Ids on change notices | Spec merged, no implementation | Gated |
| FIX-2626 | `defineKit` | Merged (#5090, #5091) | Landed |
| FIX-2627 | Workforce and the harnesses as kits. One coding worker flow | Spec merged, no implementation | Next |
| FIX-2628 | Claude Code-style lab on kits | Spec merged, no implementation | After 2627 |
| FIX-2629 | Closure | Spec only | Blocked on the children |
| FIX-2633 | Skills grants move onto the default write flow | Named by the epic, not this week's code | Named |
| FIX-2551 | `client.live` is the one watch loop | Merged (#5088) | Landed |
| FIX-2516 | One attachment shape, one scheme helper, one resolver | Children merged this week | Landed. Judge the net against ER-1 |
| FIX-2534, FIX-2536, FIX-2614, FIX-2630, FIX-2578 | Subscriptions, poll, routines, publish, a task waiting on its PR | Merged | Landed. The poll's second door is FIX-2536 D1 |
| FIX-2539 | Labs manage routines | #5108 merged during this review | Landed |
| FIX-2615 | MCP connectors epic | #5010 open, not merged | Incoming spec |
| FIX-2453 | Ticket ids out of what an adopter reads | #4907 merged | Landed. The lint reads `packages/*/src` only |

## Findings

| # | Kind | Severity | PRs | Where | What happened | In-flight | Smallest fix |
|---|---|---|---|---|---|---|---|
| 1 | Duplication | Medium | #5006, and the goal page that still teaches it | `packages/ui/registry/components/prompt-input.tsx:317` (`files` and `attachments`). `FileAttachment` at `:96`. `SourceAttachment` at `:104`. `usePromptInputReferencedSources` at `:242`. Send builds both at `:567`. Kitchen Sink reads `attachments` at `apps/kitchen-sink/app/flow-state/page.tsx:441` and `apps/kitchen-sink/components/harness-session.tsx:204`. The goal reads `files` at `goals/attachments/composer-attaches-and-refuses/pages/composer.tsx:60` and puts them inside the action input. The test pins both at `packages/ui/test/render/attachments.test.tsx:109` | The week made `FileContent` the reference a send takes, then left the AI SDK file part on the same callback. `FileAttachment`, `SourceAttachment` and the referenced-sources hook have no caller outside this file and the Kitchen Sink copy (`rg` over the repo). FIX-2516 D3 already rejected a file field inside the action input | unowned | `PromptInputMessage` keeps `attachments: FileContent[]`. Delete the other three. Point the test and the goal at that field, and have the goal send it beside the input |
| 2 | Incoherence | Medium | #4989, #5003, #5035, #5037, #5039, #5084 | No `attachment` id in `docs/mechanisms/mechanisms.yaml` (78 rows). Anchor that should be named: `toBlobRef` at `packages/contracts/src/attachments.ts:24`. False match: `recordAttachments` at `packages/core/src/helpers/record-attachments.ts:83` and `readAttachment` at `packages/core/src/helpers/attachments-capability.ts:99` share `helpers/` with `packages/core/src/helpers/harness-steering.ts`. `scripts/classify-mechanism-pr.mjs:48` maps an export to the one same-package row with the deepest shared directory. Depth 4, one candidate: `harness-steering`. Engine blob files tie across 12 rows at depth 3, so they stay unmatched | One job landed (a turn carries references, bytes live in the blob store, one resolver reads them) and the list does not name it. The two core helpers are recorded as harness steering, which is a different job | unowned | One `attachment` row, file `packages/contracts/src/attachments.ts`, anchor `toBlobRef`, overlaps `store` and `coding-harness` as distinct jobs. Move the two core modules to `packages/core/src/attachments/` so the directory rule stops calling them steering |
| 3 | Duplication | Medium | #4782 | `labs/claude-code-style/src/components/WorkingLine.tsx:39`. The indicator it redraws is `packages/ui/registry/components/streaming-indicator.tsx:65`, already installed in that lab. Teammates uses it at `labs/teammates/src/components/Popups.tsx:388`. `working-status.ts:10` says to pair the helper with `StreamingIndicator`. Call sites: `TasksPane.tsx:176`, `ThreadView.tsx:224`. `Thread.tsx` imports `WorkingDots` only | The same week installed the shared indicator and left a second in-flight line in one lab. The extra behaviour is a monospace span when the text starts with "Running " | unowned | Render `StreamingIndicator` in the task feed and the thread view. Keep `WorkingDots` for the thread row |
| 4 | Duplication | Medium | #5049 | `orderedLands` and `LandFailure` at `labs/claude-code-style/src/components/flow-state/review-hold.tsx:71` and `:76`. `rg` of those names in `packages/ui/registry/components/review-hold.tsx` is empty. `wc`: registry 411 lines, this lab 425, and Kitchen Sink, Teammates and Shift Manager match the registry | The lab edited its installed copy so the thread's accept buttons could share land order and the failure line. A registry refresh of that one file deletes both helpers | unowned | Move the two helpers into the registry file and refresh the lab copy |
| 5 | Duplication | Medium | #5041 (the pair itself is from #4417, 2 Nov, just outside the window) | `labs/claude-code-style/src/lib/use-draft-send.ts:18` and `labs/teammates/src/lib/use-draft-send.ts:18`. `cmp` says the files are identical, 43 lines. This week's commits on those paths are `0c17ebc11` and `2d003fbef`, both on #5041. React already has `useDraft` (`packages/react/src/hooks/useDraft.ts:63`) and `useSubmit` (`useSubmit.ts:23`) | Attachment settle was written twice into a hook that was already duplicated. Shift Manager did not take it | unowned | One `useDraftSend` in `@flow-state-dev/react`, taking a structural attachment handle. Both labs import it |
| 6 | Leftovers | Medium | #4907 removed them from published source. Later adds include #5106 (`packages/engine/test/views.test.ts:80`) | The rule reads `packages/*/src` at `scripts/eslint-rules/no-tracker-ids.mjs:29`. `git diff -U0 ee4fd7a89 HEAD -- packages`: 0 new JSDoc or string hits under `packages/*/src`. Tests: 48 JSDoc lines in 45 files, plus these titles: `packages/client/test/live.test.ts` (`FIX-1506`), `packages/engine/test/flowstate/resolve-slots.test.ts` (`FIX-824`), `packages/react/test/useCollectionResource-overlay.test.ts` (`FIX-739`), `packages/shift-manager/test/composer.test.tsx` (`FIX-2522`), `packages/vercel/test/handler.test.ts` (`FIX-824`), `packages/workforce/test/conversation-board-reads.test.ts` (`FIX-2286`), `packages/workforce/test/conversation-board-view-reads.test.ts` (`FIX-2621`), `packages/workforce/test/cross-org-collection-read.test.ts` (`BR-1`), `packages/workforce/test/worker-roster.test.ts` (`BR-3`, `BP-030`) | BP-006 forbids ticket ids in test JSDoc and in strings. FIX-2453 left tests outside `src` unlinted, on the assumption titles stay clean (`specs/issues/FIX-2453/SPEC.md`, "What stays as it is"). They did not. Three fixture strings in `packages/harness-manager/test/workspace.spec.ts` and `claim-board.spec.ts` pass issue keys into the branch namer as data | collides with FIX-2453 | Align with FIX-2453: reword the titles and move the JSDoc to `//` comments. Do not widen the lint. That widening would amend the spec, so it is raised on FIX-2453, not specified here. Leave the branch-namer fixtures |

Low, recorded and not in the spec:

| Kind | Where | Why it stays out |
|---|---|---|
| Hand-parsed `fsd-blob:` | Stories, fakes and tests, including `packages/ui/registry/components/attachments.stories.tsx:39` and the two labs' `fake-lab.ts`. A walk of shipped `packages/*/src` found the scheme literal only in `packages/contracts/src/attachments.ts` | The runtime has one helper. The leftovers are fixtures. Worth pointing the fixtures at `toBlobRef` later, not a second mechanism |
| Two numbers outside the limits set | `ATTACHMENT_IMAGE_MAX_EDGE = 1568` at `packages/ui/registry/components/attachments.tsx:135`. `maxFiles` at `:76`. `LISTED_DOCUMENTS = 8` at `packages/core/src/helpers/attachments-capability.ts:34`. The set is `packages/contracts/src/attachments.ts:175`. No host passes `limits` into `useAttachments` | `1568` is one constant, copied with the component. `8` is how many documents the context names, not a second copy of the per-message cap. Small |

## Already handled by incoming work

| Candidate | Handled by | Why it dropped |
|---|---|---|
| Flow `reads` and `client.derived` still exported beside views | FIX-2623 | #5121 (open, 4 of 5) refuses `derived`. The spec still requires slice 5 to remove `reads`. `runRead.ts` names that removal. Transitional |
| New `reads` on the dismissals flow (`labs/claude-code-style/workforce/flows/dismissals.mts:27`, 6 Nov) | FIX-2624 | #5111 deletes that flow's reads. Not on main yet |
| A second watch loop beside `client.live` | FIX-2551 | `useView` calls `watchView`, which calls `liveRead`. `coalesce` has one definition (`packages/client/src/live/coalesce.ts:36`). `useResourceCollection` calls `mayHold` on the session stream, which FIX-2551 kept |
| `hireWorkforce` beside `defineKit` | FIX-2627 | No host calls `defineKit` yet. The landed kit shape matches the spec's sample. The spec will internalise `hireWorkforce`. Incoming, not a second install added this week |
| `findBy` as a second query API | collection row | `findBy` is a method on the collection ref (`packages/core/src/types/resource-collection.ts:344`). `searchResources` ranks content for the model. Different jobs |
| Poll versus webhook as two readers of a GitHub thread | FIX-2536 D1 | `normalizeGitHubEvent` has one definition. The poll calls the same `deliverToRow` and `screenChain` as the service flow. The spec signed that door and rejected feeding the thread index. `poll: true` is not set in the labs |
| `publishEvent` as a second bus | FIX-2630 D1 | `publish` dispatches through the service seam and does not call the change bus. `bus.publish` under `packages/workforce/src` is 0 |
| A second subscription writer beside the routine verbs | FIX-2614 | `writeSubscription` (`subscribe.ts:336`) is the one subscription write. `saveRoutine` and `followPullRequest` call `subscribe`. Clock rows use the schedule collection |
| FIX-2578 as a second PR follow | FIX-2578 D3 | `awaitPullRequests` reads state on wake. It does not subscribe. The three hosts that wait do not pass `followPullRequest` |
| Harness packages loading bytes themselves | FIX-2516 ER-1 | Claude Code, Codex and Cursor call `readHarnessTurnFiles` |
| Each lab growing a composer | FIX-2518 | `attachments.tsx` matches the registry in the four hosts |
| Session file list beside user-line file parts | FIX-2634 | The line is the transport. `recordAttachments` is the index the model lists. The spec says so |
| Old public paths after the boundary move (FIX-2448, FIX-2449, FIX-2458, FIX-2459) | That epic, landed | Sampled names (`RequestHost`, `parkOnWait`, `HarnessBlock`, `FlowDispatchHandle`) are not exported from the old barrels |
| Previous weekly review | none | No open or merged PR whose title starts `Weekly review`. Linear itself could not be searched |

## Patterns to encode

For `distill-lessons`. Not rules.

| Class | What repeated | PRs |
|---|---|---|
| A lab redraws a shared behaviour in its own file | The review card was forked so two buttons could share an order. The send hook was edited twice for the same attachment settle. The working line was redrawn next to the indicator the same PR installed | #5049, #5041, #4782 |
| A check that does not read the files the rule names | BP-006 covers tests. `fsd/no-tracker-ids` reads `packages/*/src`. Ticket ids came back in test titles and test docs after the rule landed, and CI stayed green | #4907, then #5106 and the other test titles listed in finding 6 |
| The previous library's type stays beside the framework type | `PromptInput` still submits an AI SDK file part (`url`) and a `FileContent` reference, and a test asserts both | #5006 |

## What this review did not cover

- The 17 PRs closed without merging. Most are POCs (`#4655`, `#4686`, `#4691`, `#4699`, `#4701`, `#4748`, `#4768`, `#4774`, `#4788`, `#4790`, `#4792`, `#4794`, `#4807`, `#4812`, `#4904`, `#5040`) plus #4671 (FIX-2381, closed unmerged while #4700 and the rest of FIX-2382 merged).
- Linear. `LINEAR_API_KEY` is unset and no Linear MCP is connected, so issue status for the 60-day spec set was not read. The in-flight map is GitHub plus the retained specs. No previous weekly-review issue could be confirmed in Linear. None exists as a PR.
- Not every PR body. Four passes covered attachments, views/kits/live, event delivery, and labs plus the public-surface move. The cross-area pass was the composer shape against FIX-2516, the mechanism classifier against the attachment modules, and the lab copies against the registry.
- #4687 (subscriptions, +12,662) and the memory-growth fixes (#5071, #5103) were not read line by line. The delivery path was sampled against the mechanism rows. The memory PRs remove growth. They were not treated as new surface.
- `graft` is not installed in this environment and the checkout has no `graft/` index. Counts are from `rg`, `git diff`, and a directory-depth walk of `mechanisms.yaml`.
- Open PRs outside the week that are not in the map: #830, #866, #1312, #2367, #2585, #3013, #3102, #3156, #3970, #4255, #4411, #4486, #4843 (Version Packages). They were not part of the week's net. #4843 was not reviewed.
