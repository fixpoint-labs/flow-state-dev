---
title: Views
type: reference
description: "Every option of defineView, the three scopes, row keys, what is refused when a view is declared and when it runs, the route's failure map, and when a watching screen reads a view again."
---

# Views

A view is what a screen reads: a block that computes an answer from stored data when asked, with a scope that says whose data it reads. A view writes nothing, calls no model and stores nothing, so a screen can watch one freely. Its answer is typed by the block's output schema. The server reports which changes the run depended on, so the screen asks again when one of them happens and never names what to listen for.

The examples use the `roster` view of the `team` flow, a list of the workers a user has hired. `rosterBlock` is a handler that lists them and declares an output schema. It lives in `src/flows/team/blocks/roster-block.ts`.

```ts title="src/flows/team/views/roster.ts"
import { defineView } from "@flow-state-dev/core";
import { rosterBlock } from "../blocks/roster-block";

export const roster = defineView({
  scope: "user",
  key: (row) => row.id,
  block: rosterBlock,
});
```

```ts title="src/flows/team/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { roster } from "./views/roster";

export default defineFlow({
  kind: "team",
  actions: {},
  views: { roster },
})();
```

The map key under `views` is the view's name. For the concept behind views, see [Views](../concepts/views.md).

## `defineView` fields

`defineView(config)` returns a frozen `ViewDefinition` with `kind: "view"` and the fields you set. `ViewOutput<TView>` is its answer type and `ViewInput<TView>` its input type, both exported from `@flow-state-dev/core`.

| Field | Required | Meaning |
| --- | --- | --- |
| `scope` | yes | `"session"`, `"user"` or `"org"`. Where the view runs. |
| `block` | yes | The block that computes the answer. It must declare an `outputSchema`. A sequencer works when its last step is typed. |
| `inputSchema` | no | Replaces `block.inputSchema` for the view's input, as on an action. It is not checked when the view is declared. |
| `key` | no | A function of one row that returns a string, for a view whose answer is a list. See [Row keys](#row-keys). |
| `description` | no | Text for tooling. Defaults to `block.description`. |

A flow installs views in the `views` map of `defineFlow`. An entry that `defineView` did not return fails when the flow is defined: ``Flow "<kind>" view "<name>" is not a view. Declare it with `defineView({ scope, block })`.`` A `views` value that is not a map fails with `Flow "<kind>" declares "views" that is not a map of name to a view.`

## Which scopes may a view have?

Three: `"session"`, `"user"` and `"org"`. The caller's user and org are the principal the flow's resolver returns, as for an action. Set `authentication.resolvePrincipal` and they come from the caller's verified credentials. Without it, the default resolver reads `userId` from the request body, so any caller can name any user. User and org views keep users apart only once a resolver is set.

| Scope | Runs | Needs a session | Called with |
| --- | --- | --- | --- |
| `session` | On one session, which must already exist. A view cannot create one. | Yes | `sessionId` |
| `user` | At the caller's user scope. Each user is answered from their own rows. | No | No session id |
| `org` | At the caller's org scope. | No | No session id |

- A user or org view answers a user who has never had a session, and does not create one.
- Another user's change does not refresh a user view. A second organization reads none of the first organization's user or org rows.
- A session view on another user's session answers exactly as a session id that was never used: 404.
- A block in a user or org view that reaches for `ctx.session` is refused with `view_no_session`.
- A user view may read the caller's sessions. An org view that does is refused.
- A view called at the wrong address is 400: `view_needs_session` for a session view called without a session id, `view_takes_no_session` for a user or org view called with one.

## Row keys

| Rule | Detail |
| --- | --- |
| `key` is optional | Without it the answer is any value the block's schema allows. |
| With `key`, the answer is a list | Otherwise the run fails with `view_answer_not_keyed`: ``View "<name>" declares a `key`, so its answer must be a list``. |
| Keys are distinct strings | A repeated key, or a key that is not a string, fails with `view_answer_not_keyed`: `View "<name>"'s rows must have distinct string keys; "<id>" repeats` for a repeat, or `... distinct string keys; a key is not a string` for a non-string key. Over the route that is 422, not retryable. |
| The answer carries its keys | In row order, as `keys` on the wire answer. An empty list has `keys: []`. |
| A screen keeps rows by key | A row that did not change is the same object across answers. Rows are matched by key and compared by their JSON. |
| Only a keyed view answers partially | A view with no `key` is never handed a change. See [`ctx.view`](#ctxview-inside-a-views-block). |

The distinctness of keys is checked on each answer, not when the view is declared.

## What is refused when a view is declared?

`defineView` throws a plain `Error` at the call, before any screen asks. It checks in this order, so a bad scope with a bad block names the scope.

| Refused | The message names |
| --- | --- |
| A config that is not an object | ``defineView takes `{ scope, block }`.`` |
| A `scope` that is not `"session"`, `"user"` or `"org"` | `defineView: scope "<value>" is not "session", "user" or "org".` |
| A `block` that is not a block, or is missing | ``defineView: `block` is not a block. A view computes its answer with one block.`` |
| A block with no `outputSchema`, or one that is `z.any()` or `z.unknown()` | ``defineView: block "<name>" declares no output schema. A view's answer is typed by its block's `outputSchema`; declare one.`` |
| A `key` that is not a function | ``defineView: block "<name>"'s `key` is not a function of a row.`` |

A write, a model call or a missing session is not refused here. Those are refused when the view runs.

## What a view refuses when it runs

A view's context refuses every write and every model call, so watching a view never changes what it reads and never pays for a model. A view's input is parsed against the block's schema, as an action's is, and invalid input is 400.

| The block | HTTP | `error` |
| --- | --- | --- |
| Writes a resource, writes session or user state, or dispatches an action | 409 | `read_only` |
| Runs a generator, resolves a model, or runs an evaluator | 422 | `view_model_call` |
| Reaches for `ctx.session` in a user or org view | 422 | `view_no_session` |
| Reads liveness (`livenessOf`), which no topic covers | 422 | `view_unrecorded_read` |
| Answers a keyed view with repeated or non-string keys, or a non-list | 422 | `view_answer_not_keyed` |
| Answers partially with no change, or from a view with no `key` | 422 | `view_partial_refused` |

A view's block may be a sequencer. The reads its steps make count as the view's reads.

## Calling a view over HTTP

| View | Route |
| --- | --- |
| User or org | `POST /api/flows/<flow>/views/<view>` |
| Session | `POST /api/flows/<flow>/<sessionId>/views/<view>` |

A view the flow does not declare is 404, even if an action has that name. Success is `200` with:

| Field | Meaning |
| --- | --- |
| `output` | The block's output, `null` when absent. |
| `topics` | The change topics what the run read falls under, deduplicated and sorted. A view that read nothing has `topics: []`. |
| `hears` | Per topic, which notices may change what the run read. See [What a view hears](#what-a-view-hears). A topic names a part of the stored data, such as a session or a user's resources. A notice is the message the server sends a watching screen when something under a topic changes: `{ topic, kind, ids? }`. |
| `keys` | A keyed view's row keys, in order. |
| `partial` | `{ removed }`, set when the answer covers only the rows a change touched. |

Failures:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `view_needs_session`, `view_takes_no_session` | The call is at the wrong address for the scope. |
| 400 | `validation_error` | The input fails the block's input schema. |
| 404 | The unknown-flow message | The flow is not registered, or the flow instance is pinned to an owner (its `ownerPin`, see [Flows](./flows.md)) and the caller is outside it. Such a caller gets the same answer as for an unregistered address, whatever the view or session. |
| 404 | The unknown-view message | The flow declares no view of that name. |
| 404 | The unknown-session answer | A session view on a session that does not exist or that the caller may not run in. Same body as an unused id. |
| 409 | `read_only` | A write or a dispatch from a view. |
| 409 | `wrong-instance-session` | The session belongs to a different instance of this flow than the one addressed. |
| 409 | `migration-required` | The stored session has no recorded owner and the flow has several instances. See [Authentication](./authentication.md). |
| 422 | `view_model_call`, `view_no_session`, `view_unrecorded_read` | See [What a view refuses when it runs](#what-a-view-refuses-when-it-runs). |
| 422 | The error's own `code` | Any other non-retryable `FlowError`, such as `view_answer_not_keyed` or `view_partial_refused`. |
| 503 | The error's own `code` | A `FlowError` marked retryable. |
| 500 | `view_failed` | Any other error. `message` is the error's message. |

A request may carry `changed: { topic, kind, ids }` in its body. It is honoured when `topic` is a well-formed topic (scope `session` with a non-empty string `id`, or `user` or `org`, each with an optional string `resource`), `kind` is one of `items`, `request`, `run`, `state`, `resource`, `board`, `suspension` or `resync`, and `ids` holds 1 to 100 strings. Anything else is no change and the view runs whole. The hint decides which rows the view reads again, never who may read them.

## When a view is read again

Each answer carries the topics of what the view read. A watching screen listens to them, reads again when one changes, and listens to new topics when the answer's topics change.

| Event | Result |
| --- | --- |
| A write to anything the last run read | The view is read again, unless the answer's `hears` rules the notice out. |
| A write from another request, session, flow or client | Reaches the view the same way. A browser's write through the resource routes reaches it too. |
| A connect, a reconnect, a timer tick or a `resync` notice | Always read again, never filtered by `hears`. |
| The poll timer | Reads every 3 s by default, as cover where push can miss a change. `pollIntervalMs: null` turns it off. |
| A failed read | The watch is `stale` and tries again on its own at 1 s, doubling to 30 s. A read that lands clears `stale`. |

These events cause no read, or a narrower one:

| Event | Result |
| --- | --- |
| A notice the answer's `hears` rules out | Not read. |
| A notice with ids, on a keyed view whose answer the screen holds | The view is asked for only the rows it touches, and a partial answer is placed by key. |
| A partial answer with a key the screen does not hold | The screen reads the view whole. |
| More notices while a read is in flight | One more read, not one each: one in flight and at most one waiting. |
| An answer equal to the last | Reports no new value. Equality is by value. |
| Nothing changes, push is up and the poll is off | No view calls. |

A new input, session, client, or an `enabled` that turned off and on again starts a new watch, from no value and not stale.

### What a view hears

`hears` is a list of `{ topic, kinds, paths?, partitions? }`. A watcher reads again on a notice its topic covers whose `kind` is listed and, for a `resource` notice that names a path, whose path is at or under one of `paths`. A `resource` notice that names no path always reads. A change at an ancestor path may touch anything beneath it, so a write through a broader collection reaches a view that read a narrower one.

| What the run read | What it hears |
| --- | --- |
| A collection such as `workers/*` | `resource` notices under the collection's root, `workers`, and nothing else on its scope. |
| A single resource | Its own key. The `state` kind is added when the run also read the scope's state. |
| A session's items, metadata or history | `items`, `request`, `run` and `state` on the session topic. |
| A session's state alone | `state` on the session topic. A reply streaming in does not wake it. |
| A user [task board](./task-board.md), through its task collection, where tasks name sessions | `board` notices on each session the board names and on the user's board. Writes to the board's own resource do not wake it. |
| An org task board | Writes to the board's own resource at the org, and `board` notices on the org's board. |

A user board read in which no task names a session hears writes to the board's own resource, as a read of any resource does. A view that read nothing has `hears: []` and nothing wakes it.

A view hears a change through every read path, at every scope. A session view over a resource declared with `sharedToLineage` (see [Resources](./resources.md#scopes-and-sharing)) is woken by another session's write to it.

## Watching from a screen

`viewRef<TView>(flow, view)` from `@flow-state-dev/client` names a view for the client. Both strings are required, or it throws `viewRef: a flow address is required` or `viewRef: a view name is required`. It returns a frozen `{ flow, view }` that holds no block, so it is safe in a browser bundle. `ViewValueOf<TRef>` and `ViewInputOf<TRef>` give a handle's answer and input types.

```tsx title="src/app/sidebar.tsx"
import { viewRef } from "@flow-state-dev/client";
import { useView } from "@flow-state-dev/react";
import type { roster } from "../flows/team/views/roster";

const rosterView = viewRef<typeof roster>("team", "roster");

export function Sidebar() {
  const { value, stale, failure, refresh } = useView(rosterView);
  if (value === undefined) return <p>Loading</p>;
  return (
    <ul data-stale={stale} title={failure?.message}>
      {value.map((worker) => (
        <li key={worker.id} onClick={refresh}>
          {worker.name}
        </li>
      ))}
    </ul>
  );
}
```

`useView(ref, input?, options?)` returns:

| Field | Meaning |
| --- | --- |
| `value` | The answer, typed by the view. `undefined` until the first answer lands. |
| `stale` | `true` while the last read failed. |
| `failure` | While `stale`, `{ message, httpStatus? }`: the server's own `error` or `message` words and its HTTP status when it answered one. Absent otherwise. |
| `refresh()` | Reads the view again on demand, for every screen sharing the read. Does nothing while disabled. |

| Option | Meaning |
| --- | --- |
| `sessionId` | Required for a session view. |
| `changed` | Accepted by the type and ignored. A watched view's hint comes only from the notice that woke the read. To pass a hint, use `client.view(ref, input, { changed })`. |
| `enabled` | `false` watches nothing and answers `{ value: undefined, stale: false }`. Default `true`. |
| `pollIntervalMs` | Poll period in ms. Default 3000, `null` for none. |
| `client` | A client the host holds. Pass a stable reference. |

- Screens in one client that watch the same view with the same input share one read, and the read stops with the last watcher. Input is compared as sent, with object keys sorted.
- An omitted `input` is sent as `{}`. Any other value, `null` included, is sent as given.
- A keyed view's unchanged rows keep their identity across answers.

`client.view(ref, input?, options?)` runs a view once as the client's user and resolves `{ value, topics, keys?, partial?, hears? }`. `options` is `{ sessionId?, changed? }`. It rejects with `ClientHttpError`: 404 for an unknown view or a session the user cannot run in, 400 for input the schema refuses or a view called at the wrong scope, 422 for a view that called a model or reached for a session it does not have.

## `ctx.view` inside a view's block

`ctx.view` is set on every block of a view's run, child blocks included, and is absent anywhere else.

| Member | Meaning |
| --- | --- |
| `changed` | The change this run may answer for, `{ topic, kind, ids }`. The ids name what changed, such as a task on a `board` notice or an entry's storage key on a `resource` notice, never row keys. `undefined` on a whole run: a first read, a connect, a notice with no ids, or a view with no `key`. |
| `partial(entries, options?)` | Answers for only some rows. `entries` are placed by key over the rows the screen holds, and `options.removed` keys are dropped. Return what it returns. |

A view that never calls `partial` answers whole. Answer whole whenever a change could move a row, because a partial answer never reorders rows. `partial` throws `view_partial_refused` when the run has no `changed` or the view declares no `key`. A key the screen does not hold makes the screen read whole.

In development and tests the client checks each partial answer against a whole run. A difference logs `[flow-state-dev] "<flow>" view "<view>" answered partially for [...] and differs from a whole run`, and the screen shows the whole run.

## What a view stores

Nothing. The answer is computed on each ask and kept nowhere, and every store is unchanged after any number of calls. The data a view reads belongs to the flow's resources.
