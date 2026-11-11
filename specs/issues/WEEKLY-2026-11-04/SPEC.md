# Weekly review · 4–11 November 2026

**Spec** · [Decisions](DECISIONS.md) · [The review](assets/weekly-review.md)

Linear could not be reached from the run that wrote this, so this directory is `WEEKLY-2026-11-04` until an issue exists and the directory takes its id. The review's evidence is [assets/weekly-review.md](assets/weekly-review.md).

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **attaches a file and sends** | The composer hands the page two representations of that file. The page that ships uses one. The example goal sends the other, inside the action input | The composer hands over one reference, the one the send already takes |
| **adds the next attachment helper** | The mechanism list has no attachment row, so the two helpers that live beside harness steering are classified as harness steering | The list has one attachment row. Those helpers no longer sit in the directory that makes them look like steering |
| **watches a coding task in the Claude Code-style lab** | That lab draws its own working line. Teammates draws the shared indicator for the same moment | Both labs draw the shared indicator |
| **accepts a coding review in that lab** | The land order and the failure line live on a private copy of the review card. A registry refresh deletes them | They live on the registry card, and the lab's copy matches it |
| **sends from either coding lab** | Each lab keeps the same send hook, and this week both copies grew the same attachment handling | One hook, used by both |
| **writes a test whose title names a ticket** | Titles and test docs landed this week still name tickets. The published-code check does not read them, which [FIX-2453](../FIX-2453/SPEC.md) left that way on the assumption the titles stay clean | Those titles and docs say the behaviour. The check's reach stays where FIX-2453 put it |

The week also landed views, kits, one live read, and one path from an outside event into a session. Those are in the review's "already handled" table. This spec does not reopen them.

## The goal, and how we'll know it's met

**A file leaves the composer as one reference, the attachment job has one name in the mechanism list, the two coding labs share one working line, one review card and one send hook, and the test titles and test docs this week added no longer name a ticket.**

| Is it the right goal? | |
|---|---|
| **The real need** | The week's net should not leave a second way to do a job the week already settled, or a check that cannot see the place the ids came back |
| **Smaller, and rejected** | "File the report and change nothing." The second composer shape and the forked review card are already on main, and the next lab will copy them |
| **Bigger, and not this issue's** | Retire flow reads and scope `derived` ([FIX-2623](../FIX-2623/SPEC.md), slice 4 open, slice 5 still required). Move workforce onto kits ([FIX-2627](../FIX-2627/SPEC.md)). Put `1568` and the composer's own file cap into the one limits set. Widen `fsd/no-tracker-ids` to tests, which would amend [FIX-2453](../FIX-2453/SPEC.md). Those stay listed in the review, not in this spec |
| **Not done if** | The composer test still asserts both file shapes. A registry refresh drops the land helpers. The ticket ids move from a title into a string the test does not need |

No product goal check. Nothing a person can do is new. The proof is the composer test, a diff of the test titles, and the mechanism row. A submit payload that still has a `files` field must fail the composer test, and that failure is shown before the pass. Widening the tracker lint is not the proof: FIX-2453 left tests outside `src` unlinted on purpose.

## What changes

![Six rows, today beside after: two file shapes become one reference, attachment helpers stop counting as harness steering, the private working line and the private review card become the shared ones, two send hooks become one, and test titles say the behaviour instead of naming a ticket](figures/what-changes.svg)

The left column is on main today. The right column is this spec. Each row can ship as its own PR. The implementer chooses the split.

**`packages/ui` — the composer keeps one file shape.** `PromptInputMessage` (`packages/ui/registry/components/prompt-input.tsx:317`) carries `files: FileAttachment[]` and `attachments: FileContent[]`. Send builds both (`:567`). Kitchen Sink uses `attachments` (`apps/kitchen-sink/app/flow-state/page.tsx:441`, `apps/kitchen-sink/components/harness-session.tsx:204`). The composer goal sends `files` inside the action input (`goals/attachments/composer-attaches-and-refuses/pages/composer.tsx:60`). `FileAttachment` (`:96`), `SourceAttachment` (`:104`) and `usePromptInputReferencedSources` (`:242`) have no caller outside this file and its Kitchen Sink copy. Delete those three and the `files` field. The message keeps `attachments: FileContent[]`. The composer test (`packages/ui/test/render/attachments.test.tsx:109`) and the goal assert that one field, and the goal sends it beside the input, as [FIX-2516 D3](../../epics/FIX-2516/DECISIONS.md#d3) already requires. Refresh the installed copies so they stay byte-identical.

**`packages/ui` — one working line.** `labs/claude-code-style/src/components/WorkingLine.tsx:39` redraws the in-flight line (message, elapsed, status). Teammates wraps the registry indicator for the same moment (`labs/teammates/src/components/Popups.tsx:388`). The helper that builds the message says to pair it with `StreamingIndicator` (`labs/claude-code-style/src/components/flow-state/working-status.ts:10`). The task feed and the thread view render `StreamingIndicator`. `WorkingDots` stays for the thread row (`Thread.tsx:145`), which is a different mark.

**`packages/ui` — the review card is the registry's.** `orderedLands` and `LandFailure` exist only on the lab's copy (`labs/claude-code-style/src/components/flow-state/review-hold.tsx:71` and `:76`). The registry file has neither, and the other hosts match it. Move both helpers into `packages/ui/registry/components/review-hold.tsx` and refresh the lab copy. `ReviewAccept.tsx` keeps importing them from the copy, which then matches the registry.

**`packages/react` — one send hook.** `labs/claude-code-style/src/lib/use-draft-send.ts` and `labs/teammates/src/lib/use-draft-send.ts` are the same 43 lines, and this week both grew the attachment settle. The hold is already `useDraft` and `useSubmit` (`packages/react/src/hooks/useDraft.ts:63`, `useSubmit.ts:23`). One `useDraftSend` beside them. It takes a structural handle (`files`, `refusals`, `settle`, `consume`), not a UI import. Both labs import it. The two copies go.

**`docs/mechanisms` and `packages/core` — the attachment row, and the helpers leave `helpers/`.** There is no attachment row. `scripts/classify-mechanism-pr.mjs` maps an export to the one row in the same package whose file shares the deepest directory (`:48`). `recordAttachments` (`packages/core/src/helpers/record-attachments.ts:83`) and `readAttachment` (`packages/core/src/helpers/attachments-capability.ts:99`) share `packages/core/src/helpers/` with harness steering, so they map to that row and to no other. Add one `attachment` row whose `file` is `packages/contracts/src/attachments.ts` and whose anchor is `toBlobRef` (`:24`). Move the two core modules to `packages/core/src/attachments/` so that directory rule stops calling them steering. Overlaps: `store` and `coding-harness`, distinct jobs. The row's one file cannot also be the core module, so those core exports stay unmatched rather than mis-named. That advisory label is accepted. A classifier that covers a directory is not this change.

**Tests — titles and docs say the behaviour.** [FIX-2453](../FIX-2453/SPEC.md) keeps tests outside `src` unlinted, and says BP-006 already keeps ticket labels out of their titles (`SPEC.md` → "What stays as it is"). Since #4907 (`ee4fd7a89`), published `src` gained no ticket id in a JSDoc block or a string. Tests gained 48 JSDoc lines in 45 files and 11 titles (`it` / `describe`) that name a ticket, including `packages/engine/test/views.test.ts:80` and `packages/workforce/test/conversation-board-view-reads.test.ts:28`. Reword the titles and move the JSDoc to `//` comments. Do not widen `fsd/no-tracker-ids`. Issue keys passed as data into the branch namer (`packages/harness-manager/test/workspace.spec.ts`) stay. Widening the lint is an amendment to FIX-2453, named in the PR body, not done here.

**Docs:** no new user page. `docs/mechanisms/mechanisms.yaml` changes in the implementation PR. A changeset for `@flow-state-dev/ui` (the removed composer exports) and `@flow-state-dev/react` (the hook). Package READMEs do not name the removed exports today. `/release-docs` writes them if a later pass lists the composer.

## What stays as it is

- The blob store, `resolveAttachment`, and `readHarnessTurnFiles`. Harness packages already call the one resolver.
- The session list of files (`recordAttachments`) and the file parts on the user line. Those are the index and the transport ([FIX-2634](../FIX-2634/SPEC.md)).
- Views, kits, `client.live`, and the subscription delivery. In flight or already one path. See the review.
- `WorkingDots` on the thread row.
- Issue keys passed as data into the branch namer.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| `FileContent` references and `toBlobRef` ([FIX-2516 ER-1](../../epics/FIX-2516/DECISIONS.md#who-owns-what), [D3](../../epics/FIX-2516/DECISIONS.md#d3)) | **Builds on.** The composer stops offering the other shape. The goal stops sending files inside the action input |
| `StreamingIndicator` and `workingStatus` | **Builds on.** The Claude Code-style task feed renders the indicator. The private line goes |
| Registry `review-hold.tsx`, installed as a byte copy | **Extends** with the two helpers the lab added, then the copy matches again |
| `useDraft` and `useSubmit` | **Extends.** `useDraftSend` is those two plus the attachment settle the labs already wrote twice |
| `fsd/no-tracker-ids` ([FIX-2453](../FIX-2453/SPEC.md)) | **Leaves the reach alone.** Tests outside `src` stay unlinted, as that spec says. The titles and JSDoc that broke its assumption are rewritten |
| `mechanisms.yaml` rows `store`, `coding-harness`, `harness-steering` | **Extends** the list with `attachment`. Steering stops being the nearest row for the attachment modules |
| Flow reads, `client.derived`, kits, `client.live`, subscription delivery | **Leaves alone.** Owned by FIX-2623, FIX-2624, FIX-2626, FIX-2627, FIX-2551, FIX-2534 |

Searched for another composer submit shape: `FileAttachment` and `usePromptInputReferencedSources` occur in the registry file and the Kitchen Sink copy only. Searched for another working line: `WorkingLine` is the Claude Code-style component and a thin Teammates wrapper around `StreamingIndicator`.

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `attachment` row | `store` · blob slot; `coding-harness` · `readHarnessTurnFiles`; `harness-steering` · nearest directory | None of those jobs is "a turn carries file references." The row names the helper the epic already made the one writer of the scheme. No new runtime |
| `useDraftSend` | `react` · `useDraft`, `useSubmit` | Composed from those two. The attachment handle is the argument. The lab copies go |

| The debt | |
|---|---|
| **Removes** | `FileAttachment`, `SourceAttachment`, the referenced-sources state, `PromptInputMessage.files`, `WorkingLine`'s in-flight row, the two `use-draft-send` copies, the lab-only review helpers (they move, the fork goes), the ticket ids in the test titles and test docs this week added |
| **Adds** | One mechanism row. One hook that replaces two copies. Core attachment exports stay unmatched by the classifier, because a row names one file. Accepted: unmatched is an honest advisory label, and mis-naming them as steering is not. No follow-up issue for a multi-file classifier |
| **Leaves** | `ATTACHMENT_IMAGE_MAX_EDGE` (`1568`) and the composer's own `maxFiles` sit outside `ATTACHMENT_LIMITS`. `LISTED_DOCUMENTS` (`8`) is how many documents the context names. Hand-written `fsd-blob:` literals in tests, stories and fakes. All three are in the review under Low, and none is this spec |

**Net: down.** Two file shapes, a private working line, a forked card and a duplicated hook go. One row and one hook are added, and the hook replaces two files.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** the six rows in the figure, and nothing else the week left in flight. If wrong: we pull views, kits or the event path into this cleanup and fight the specs that already own them.

**[The debt](#whats-already-here-and-the-debt), net down:** the second seams go. One mechanism row and one hook are added. If wrong: the row is treated as a new runtime, or the hook grows a UI dependency and a second attachment type.

**Open: none.** There is no product fork. The anchor file, the package of the hook, and leaving the command in ordinary type are recorded in [Decisions](DECISIONS.md) as decided and not asked.

Improvement · `ui` + `react` + `core` + `contracts` · the six rows above · no epic
