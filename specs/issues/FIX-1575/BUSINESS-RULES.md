# FIX-1575 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The *proved by* column is the check the plan runs. Every case here
is about a line of prose or a name; no runtime behaviour changes.

## Sorting a line

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A line describes a Layer 1 mechanism in Workforce words (seat, hire, roster, "a workforce") | Reworded in Layer 1 terms: *assignee*, *owner-pinned instance*, *the board*, *the dispatcher* | Inventory `--after`: every F line gone |
| BR-2 | A line is a public name, literal, schema field or model-facing string | Left byte for byte; recorded against its follow-up (D2) | Inventory `--after`: every R line still present |
| BR-3 | Reworded prose has to mention a kept public name (`seat`, `MANIFEST_DOMAINS`) | The name appears in a code span; the prose around it uses the Layer 1 word | Inventory `--after` ignores hits inside code spans only |
| BR-4 | A line names Workforce or Orchestration as a consumer ("Workforce pins each hired seat this way") | Kept | Inventory: every KC line still present |
| BR-5 | A line uses the word in its ordinary sense (the trace store's request roster, "an operator's seat", "keeps its seat") | Kept | Inventory: every KE line still present |
| BR-6 | A line cites a published page's title or anchor ("Upgrading: moving hired seats' stored data") | Kept; the page is not this issue's | Inventory: KP line present |
| BR-7 | A line uses board, task, ledger, claim or `boardId` | Not a finding (D1) | Not in the vocabulary; review |
| BR-8 | A rewrite reaches for *worker* to replace *seat* or *assignee* | Refused: pick *assignee* or *dispatcher* | Review; `grep -n worker` over the diff |

## Behaviour that must not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | Any exported symbol, type or literal in Core, Engine or Contracts | Unchanged | `pnpm typecheck`; `git diff` touches no non-comment code line except error strings |
| BR-10 | A hand-off crosses boards, or a task entry is declared with no board | The same refusal fires at the same place; only its sentence changes | Existing `defineFlow` and `runAction` suites pass; any test asserting on the old sentence is updated in the same PR |
| BR-11 | The discovery tool's description and domain list | Unchanged (R2): a model prompt changes only with its follow-up | Inventory R2 lines present |
| BR-12 | #2236's guard test | Still passes, unedited | `pnpm --filter @flow-state-dev/engine test` |

## Failure taxonomy

Nothing here can fail at run time. The one real risk is a rename slipping in under a wording
change, which BR-2 and BR-9 catch. A reworded error sentence that a test asserts on fails that
test loudly, which is the intended signal to update it.

## Acceptance criteria this issue owns

On `main` after #2236, `node specs/issues/FIX-1575/poc/vocabulary-inventory/check.mjs --after`
passes: no Workforce word describes a Layer 1 mechanism in Core, Engine, Contracts or their
in-repo docs, and every kept line (public names, consumer mentions, ordinary English) is where
it was.
