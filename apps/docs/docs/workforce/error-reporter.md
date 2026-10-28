---
title: The Error Reporter
sidebar_position: 12.5
sidebar_label: Error Reporter
description: A worker that turns a failure that stayed failed, or a problem a user describes, into one bug report. The operator previews it in Inbox before it is filed to the tracker.
---

# The Error Reporter

Failures in a running app tend to get lost. A request fails, a task ends errored, someone notices a board that says "done" for work that never ran, and nobody writes it down. The Error Reporter is a worker that writes it down for you. It turns each failure into one bug report that an engineer can reproduce from, shows it to the operator, and files it to your tracker once they say yes.

It comes from `@flow-state-dev/workforce`. You register two flows and hand the engine one callback.

## What gets reported

Four things reach it:

- **A request that settled failed.** The engine's [error capture](../advanced/error-capture.md) sends one `final` event per request that ends failed, after rescues and retries. The reporter takes only those events, so a failure that a retry fixed is never reported.
- **A task that ended errored** on a conversation board, including a task that gave up without throwing. A task's failed requests join the task's report instead of making reports of their own. The report goes out with the notice that tells the filing conversation the task failed, so if a crash loses that notice, the report is sent again when the notice is. A routed task, a message a coordinator hands to a delegate, counts too: when the delegate's turn fails, its report goes out as the task ends. A cancelled task is not reported, and neither is a routed task whose run the user stopped: it ends cancelled, not errored. If the user cancelled because something went wrong, they can still report it as a problem (below), naming the task. A Shift Manager Lab says so on the cancelled task's card.
- **A coordinator's own crash that it answered.** A best-fit coordinator whose turn fails tells the user "Nobody took this message", so the request doesn't fail. The crash is still reported.
- **A problem a user describes.** A user messages the Error Reporter in its own conversation ("the board shows a task as done that never ran"), optionally naming the session, task or project. A named session is read only if it belongs to the user who named it.

The reporter never reports its own failures.

## One report per problem

Each occurrence gets a fingerprint from its flow, action, error code and normalized message. For a problem a user describes, the description stands in for the message. Occurrences with the same fingerprint are one report, and a repeat raises its count. Redelivering the same occurrence counts it once.

So a bad deploy doesn't fill your tracker, new reports are capped per window: five an hour by default. Past the cap, failures go into one **storm report** that lists them.

## From failure to filed issue

1. **Gathering.** The reporter collects a dossier by code: the failing requests, the sessions they ran in, the failing session's project, and links to them. Secrets are removed before anything is stored: the environment's keys, values you pass in `secrets`, and the operator's stored MCP keys.
2. **Drafting.** A coding harness reads your code and drafts the issue: summary, steps to reproduce, expected and actual, suspected cause, and any questions. The drafting run gets no tracker tools.
3. **Preview.** The draft waits for the operator as an ordinary form, which a Shift Manager Lab shows in Inbox. The operator files it, files it with instructions ("label it P1"), or dismisses it. Nothing is filed before they answer unless you say otherwise.
4. **Filing.** A separate run files the issue through the tracker project's MCP servers, such as Linear, with the operator's key. If filing fails, the report stays approved and is tried again.

A repeat of a filed report adds a comment to the issue, at most once an hour by default. A dismissed report only counts repeats for a day before it can be reported again.

Work the reporter owes survives a restart. When it starts, it picks up every report still waiting to be drafted, filed or commented on.

## Turning it on

```ts
import { createFlowState } from "@flow-state-dev/engine";
import {
  createErrorReporter,
  defineErrorReporterFlow,
  defineErrorReporterIntakeFlow,
} from "@flow-state-dev/workforce";

const reporter = createErrorReporter({
  worker: "error-reporter",
  operator: { userId: "olive", orgId: "acme" },
  tracker: { project: "shared/storefront" },
});

// The reporter's worker flow, registered beside your other worker flows.
const reporterFlow = defineErrorReporterFlow({
  reporter,
  installation,
  harness: myCodingHarness,
  mcpTools: projectMcpTools,
});

// Its intake: a plain flow of its own.
const intake = defineErrorReporterIntakeFlow({ reporter });

const flowState = createFlowState({
  flows: { /* your flows, the hired copies, and the intake */ },
  durable: true, // needed with in-memory stores; on by default over persisting stores
  errorCapture: reporter.capture,
});

await reporter.bind(host); // after the runtime exists
```

`worker` names a `WORKER.md` on your installation whose flow is `error-reporter`. `bind` takes the runtime operations the reporter runs through: running an action, opening and reading sessions, and reading requests. A Shift Manager Lab does all of this for you when you pass `errorReporter` to `openLab`.

Without `tracker`, reports are kept and previewed but never filed.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `preview.autoFile` | none | Error codes, or sources (`request`, `task`, `manual`, `storm`), that file without waiting for the operator. |
| `preview.autoFileAfterMs` | never | Files the draft as written when the preview goes unanswered this long. |
| `limits.newPerWindow` | `5` | New reports allowed per window before the rest go into a storm report. |
| `limits.windowMs` | 1 hour | The cap's window. |
| `limits.commentEveryMs` | 1 hour | How often a filed report gets a comment about repeats. |
| `limits.dismissForMs` | 24 hours | How long a dismissed report only counts repeats. |
| `filter` | all | Report only the failures this returns `true` for. |
| `secrets` | none | Extra values no report may hold. |
| `links` | none | Links for an occurrence, such as a trace or a task page, by label. |

## What it will not do

It doesn't fix the bug or open a pull request. It writes one issue and stops. It runs on its own flow, never through the Shift Coordinator or another coordinator. Telling it how to work ("always label these P2") saves a [standing rule](./standing-rules) instead of filing a report.
