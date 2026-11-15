---
title: Error reporter
type: catalog
description: A worker that turns a failure that stayed failed, or a problem a user describes, into one bug report, shown to the operator before it is filed to Linear.
---

# Error reporter

Failures in a running app get lost. A request fails, a task ends errored, a user notices something wrong, and nobody writes it down. The Error reporter is a worker that writes it down. It turns each failure into one bug report an engineer can reproduce from, shows the report to the operator (the user who runs the app), and files it to Linear once they say yes.

There is one report per problem. Failures that differ only in their ids, numbers and paths count as the same problem, so a bad deploy that fails the same way a hundred times is one report, and one Inbox card, with a count of 100.

## What you get

A worker, two flows and an engine option. They ship in `@flow-state-dev/workforce` beside the workforce kit, not inside it, so you wire them up yourself. The reporter opens no slots of its own. The coding harness it reads your code with is a parameter you pass in.

A report starts from a failure that stayed failed, or from a problem a user describes.

**A failure that stayed failed.** A request is reported only if it ends failed after its retries and error handlers, so a failure a retry fixed is never reported. A task that ends errored on a conversation board is reported too. A cancelled task is not. The [workforce reference](../../reference/workforce.md) lists each trigger.

**A problem a user describes.** A user messages the reporter in its own conversation: "the board shows a task as done that never ran". They can name a session, a task or a project. The reporter reads a named session only if it belongs to the user who named it.

The reporter never reports its own failures, and its runs don't appear on any coordinator's board. It writes one issue and stops: it does not fix the bug or open a pull request.

## Install it

```ts title="src/error-reporter.ts"
import { createFlowState } from "@flow-state-dev/engine";
import {
  createErrorReporter,
  defineErrorReporterFlow,
  defineErrorReporterIntakeFlow,
  type ErrorReporterFlowOptions,
  type ErrorReporterHost,
} from "@flow-state-dev/workforce";

export async function startErrorReporter(
  deps: Pick<ErrorReporterFlowOptions, "installation" | "harness" | "mcpTools">,
  host: ErrorReporterHost,
) {
  const reporter = createErrorReporter({
    worker: "error-reporter",
    operator: { userId: "olive", orgId: "acme" },
    tracker: { project: "shared/storefront" },
  });

  const reporterFlow = defineErrorReporterFlow({ reporter, ...deps });
  const intakeFlow = defineErrorReporterIntakeFlow({ reporter });

  const flowState = createFlowState({
    flows: [reporterFlow(), intakeFlow()],
    errorCapture: reporter.capture,
    durable: true, // the operator's answer waits across restarts; on by default over a persistent store
  });

  await reporter.bind(host);
  return flowState;
}
```

`deps` carries three values you already have or build once: your worker installation, a function that builds the coding harness that reads your code, and the tracker's MCP tools. `host` is an object you write. It runs a flow action as a user, opens and reads sessions, and reads a failed request. Its `conversationSessionId` names the conversation the reporter writes to.

Call each flow definition once and pass the result to `flows`. `worker` names a `WORKER.md` whose `flow` is `error-reporter`.

The reporter waits for the operator's answer across restarts, so the host needs durable execution. The [workforce reference](../../reference/workforce.md) has every option and the durable-execution default.

A Shift Manager Lab does all of this when you pass `errorReporter` to `openLab`.

## Use it

For each report, the reporter gathers what failed, a coding harness drafts the issue, the operator answers, and only then is it filed. Before anything is stored or shown, the reporter removes the values of environment variables whose names contain KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL, AUTH, COOKIE or PRIVATE (8 characters or longer), the values `createErrorReporter`'s `secrets` function returns, the user's stored MCP keys, and text shaped like a known key. Any other secret in the error, such as a password inside `DATABASE_URL`, is kept and filed with the report, so return it from `secrets`.

The operator sees the draft as an ordinary question in Inbox:

```text
Error report: Checkout fails on a project with no repository

Seen 1 time. File it?

Questions
- Which team?
```

They answer File, File with instructions ("put it in the Platform team"), or Don't file. Nothing is filed before they answer unless you set `preview.autoFile` or `preview.autoFileAfterMs`; the [reference](../../reference/workforce.md) has both.

When it files, the reporter writes a line in its own conversation:

```text
Filed FIX-9: Checkout fails on a project with no repository https://linear.app/acme/issue/FIX-9
```

If filing fails, the report stays approved and is tried again, including after a restart. Without `tracker`, reports are kept and previewed but never filed. Filing goes to Linear only, through the tracker project's MCP servers.

A repeat of a filed report adds a counted comment to the issue, at most once an hour. If that issue has been completed or canceled, the reporter does not comment; the next repeat starts a new report that links the old issue. A burst of new failures becomes one storm report instead of many. A dismissed report counts repeats with no new card for a day, then a repeat starts a new report. The [reference](../../reference/workforce.md) has the limits and what closes a report.

Two different bugs that fail the same way in the same block share a report.

## Slots it opens, slots it fills, views it serves

It opens no slots and fills none. It serves the Inbox question and its own conversation. A Shift Manager Lab also draws a note on a cancelled task's card, linking to that conversation, so a user can report a cancel that followed a problem.

## Change it

Edit the reporter's `WORKER.md` to change its instructions. Telling it how to work ("always label these P2") saves a [standing rule](./standing-rules.md) instead of filing a report.

The options change what gets reported and how often: `filter`, `limits`, `secrets` and `links`. Options and defaults are in the [workforce reference](../../reference/workforce.md).
