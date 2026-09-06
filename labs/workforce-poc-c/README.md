# Workforce POC lab C — plan = board + content

The plan capability **is** the existing task board. The spec is resource text.
The tasks are the structured half of that same plan. This lab proves that on
today's APIs. It is a never-merge POC, not a product.

## The proof

One session is one plan. Three zero-model actions:

1. `writePlan` — `writeContent` on a sibling `defineResource` (`spec`)
2. `addTask` — `taskBoard({ name: "plan" }).capability.addTask`
3. `readPlan` — `readContent` + `listTasks` on that same session

```bash
# From this directory. Same --session is the same plan.
pnpm test

pnpm fsdev run workforce-poc-c writePlan \
  -i '{"body":"# Ship the intake form\nValidate email. Do not add a CRM."}' \
  --session plan-demo

pnpm fsdev run workforce-poc-c addTask \
  -i '{"id":"validate-email","goal":"Reject blank and malformed emails on submit","title":"Validate email"}' \
  --session plan-demo

pnpm fsdev run workforce-poc-c readPlan -i '{}' --session plan-demo
```

`readPlan` returns the spec body and the task rows. There is no document
database and no planner block in this lab.

## Exists vs proposed

| Claim | Status | Pin |
| --- | --- | --- |
| Plan prose is `defineResource` + `writeContent` / `readContent` | **exists** | `packages/core/src/types/resource.ts` — `ResourceRef.writeContent` / `readContent`. Empty resource reads `null`; a write persists the body. |
| Tasks are `taskSchema` on a `defineTaskCollection` | **exists** | `packages/orchestration/src/tasks/schema/task.ts` (`goal`, optional `title` / `context`, `parked`). Collection: `define-task-collection.ts`. |
| The board is `taskBoard` | **exists** | `packages/orchestration/src/task-board/index.ts`. `board.capability` is `addTask` / `listTasks`. |
| Same session joins the two halves | **exists** | Both declared `scope: "session"`. A second session reads empty. No join table. |
| `taskBoard` itself has a content slot | **not on the board** | `TaskBoardConfig` has no spec/content field. `defineTaskCollection` does not pass `content` / `contentTemplate` through. Atlas already places prose on a sibling `defineResource`. That is the API, not a missing store. |
| A typed `Plan` that owns both halves | **proposed (L2)** | Convention: one session, one board name, one spec resource. No Layer 1 `Plan` type. |
| A second planner / doc store | **cut** | Not imported. `planAndExecute` is a caller of this board, not used here. No Workforce package. |

## What this is not

- Not `@flow-state-dev/workforce`
- Not a new L1 package
- Not a drain / worker-execution demo — the worker exists only because
  `taskBoard` requires one
- Not a claim that plan text belongs *on a task row*. Instance `writeContent`
  exists on every resource, including task instances. Using a row as the spec
  would invent a convention the atlas refused.

## Finding

Content APIs can hold a plan honestly: the spec is a resource body, the tasks
are the board. The "plan" is those two reads under one session. Stop here —
do not invent a doc store to make them one object.
