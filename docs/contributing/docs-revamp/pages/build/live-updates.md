---
title: Push live updates to the browser
type: recipe
description: "Some screens show data other users or agents change: a list of requests a teammate's worker is answering, a project's files."
---

# Push live updates to the browser

Some screens show data other users or agents change: a list of requests a teammate's worker is answering, a project's files. Without help, the screen goes stale until it reads again. This recipe has the screen read again when the data changes.

The server tells the screen *when* something changed under a topic (a name for what to listen to, such as one session), never *what*. The screen then makes the read it already makes, and the server checks that read like any other. If your read is a view, use `useView` instead and skip this recipe: it listens for you (see the [views reference](../reference/views.md)).

## 1. Make a client for your reads

```ts title="src/lib/fsd.ts"
import { createClient } from "@flow-state-dev/client";

export const fsd = createClient({ userId: "devuser", baseUrl: "" });
```

`baseUrl: ""` is your page's own origin. `fsd.sessions.requests` lists the requests run in one session, and it is the read the next step keeps current.

## 2. Subscribe on the screen

```tsx title="src/app/RequestList.tsx"
"use client";

import { useEffect, useRef, useState } from "react";
import { topic, type SessionRequestSummary } from "@flow-state-dev/client";
import { useSubscription } from "@flow-state-dev/react";
import { fsd } from "../lib/fsd";

export function RequestList({ sessionId }: { sessionId: string }) {
  const [requests, setRequests] = useState<SessionRequestSummary[]>([]);
  const latest = useRef(0);

  async function load(signal: AbortSignal) {
    const read = ++latest.current;
    const rows = await fsd.sessions.requests(sessionId);
    // Only the read started last may set the list: an older one can finish later.
    if (!signal.aborted && read === latest.current) setRequests(rows);
  }

  // The hook reads only once it connects or its timer ticks, so the first read is yours.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [sessionId]);

  useSubscription(
    [topic.session(sessionId)],
    (notice, signal) => {
      if (notice !== null && notice.kind === "items") return; // a reply streaming in
      return load(signal);
    },
    { client: fsd, pollIntervalMs: 3000 },
  );

  return (
    <ul>
      {requests.map((request) => (
        <li key={request.id}>{request.actionName}: {request.status}</li>
      ))}
    </ul>
  );
}
```

`topic.session(id)` covers a session's requests, their items and the runs started under it. `topic.user()` and `topic.org()` cover the signed-in user and their organization, and take no id: the server uses the caller it signed in, so a screen can only hear its own.

On a host that pushes (`serve()` from `@flow-state-dev/node`, see step 4), the read runs as soon as the change is saved, and it sees the change. A burst of changes runs the read once more after the one in flight, not once per change. You can pass a new topics array or a new function on every render without resubscribing.

Your effect's read and the hook's reads are not queued behind each other, so a
slow first read can finish after a newer one. The `latest` counter keeps the
list from going back to the older rows.

The example passes `fsd` as `client`, so the subscription signs in the way your reads do. Without `client`, the hook uses the `FlowProvider`'s client, or, outside a provider, one for `devuser` on the page's origin.

## 3. Ignore changes you don't show

The read gets the notice that woke it, `{ topic, kind, origin? }`, or `null` after a connect, a reconnect or a timer tick. On a host that pushes, the hook runs your read once with `null` when it connects, so the screen reads twice on mount: your effect's read, then that one. The example skips `"items"` notices because a reply streaming in sends many and the request list doesn't change with them. Read everything on `null` and on `"resync"`, which means the screen may have missed something. The other kinds are in the [client reference](../reference/client.md).

Narrowing the topic does the same with less code: `topic.session(id, { resource: "plan" })` only hears changes to that one resource, so a long reply never wakes it.

## 4. Run it on any host

The code is the same on every host. On `serve()` from `@flow-state-dev/node`, which `fsdev dev` and `fsdev serve` use, the client holds one WebSocket and the server pushes. On Vercel, Next.js or `createServerApp` alone there is no push, and the read runs every `pollIntervalMs`. Leave `pollIntervalMs` out on one of those and the screen never changes after its first read. The [HTTP API reference](../reference/http-api.md) has the full table.

If your app runs as one process, the default stores work. If several processes write your stores (several servers on one SQLite file, or `fsdev run` writing the file `fsdev dev` serves), use a store set that shares changes across processes, such as Postgres. Otherwise an open screen hears another process's changes only at its next read, which on a host with no push and no `pollIntervalMs` may never come. See [stores](../reference/stores.md).

## 5. Check who hears what

Each topic is checked when the connection opens, with the same check the matching read uses. A topic the caller may not read is dropped, the same as a session that doesn't exist, and the screen never hears from it. Credentials come from the client's `fetcher`, a bearer token or a cookie. If someone loses access while their tab is open, their reads are refused at once. The open connection keeps sending notices until it reconnects, but a notice carries no data. The [HTTP API reference](../reference/http-api.md) has the rules.

## When not to use this

- A session's own state, and its user's, organization's and resources: `useSession(sessionId, { live: true })` and the hooks built on it follow changes to that state for you, whichever session or process makes them.
- A session's own messages as they land: `useSession(sessionId, { live: true })` or `fsd.sessions.stream`. Those carry the items themselves.
- Code outside React: call `fsd.subscribe` directly (see the [client reference](../reference/client.md)).
- A task board's changes: they are announced on the session that filed the task, wherever the change was made (see the [task board reference](../reference/task-board.md)).
