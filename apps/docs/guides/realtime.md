---
sidebar_label: Realtime screens
---

# Keeping a screen current

Some screens show data other people or agents change: a task board a team works, a list of runs, a project's files. Without help, the screen goes stale until it reads again. This guide shows how to have the screen read again when the data changes, with code that works the same on every host.

The idea is small. The server tells your screen *when* something under a topic changed. Your screen then makes the read it already makes, which says *what*. Nothing about the data travels with the notice, and every read is checked on the server like any other.

## The hook

Hand `useSubscription` the topics your screen shows and the read it makes:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useSubscription } from "@flow-state-dev/react";
import { createClient, topic } from "@flow-state-dev/client";

const fsd = createClient({ userId, baseUrl: "" });

type Task = { id: string; title: string };

function TaskList({ sessionId }: { sessionId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const refresh = useCallback(
    () => fsd.flow("support").read<Task[]>("listTasks_tasks", {}, { sessionId }).then(setTasks),
    [sessionId],
  );

  useEffect(() => void refresh(), [refresh]); // the first read
  useSubscription([topic.session(sessionId, { resource: "tasks" })], refresh, { pollIntervalMs: 3000 });

  return <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>;
}
```

On the Node host, `refresh` runs as soon as the change is saved: the server sends the notice once the change can be read, and no timer is involved, so the delay is the network and your read. A burst of changes runs it once more after the read in flight finishes, not once per change. The hook doesn't read on mount, so keep the first read where your screen already makes it. It subscribes through the provider's client; an app that builds its own client, with its own `fetcher`, passes it as `client` so the socket signs in the same way.

| Topic | What changes it covers |
|-------|------------------------|
| `topic.session(id)` | One session: its requests, their items, runs started under it, and changes to its task boards. |
| `topic.user()` | The signed-in user's own scope. |
| `topic.org()` | The signed-in user's organization. |

Each takes `{ resource }` to narrow it to one resource, such as `topic.session(id, { resource: "tasks" })`. User and org topics name no id. The server uses the caller it signed in, so a screen can only hear its own user and organization.

## Acting on what changed

`refresh` gets the notice that woke it, `{ topic, kind, origin? }`, or `null` when the screen should read everything again: after a connect or a reconnect, on a timer tick, and when push starts or stops reaching every server process. A screen that only cares about some changes can skip the others:

```ts
useSubscription([topic.session(sessionId)], (notice) => {
  if (notice !== null && notice.kind === "items") return; // a reply streaming in
  return refresh();
});
```

`kind` is `"items"`, `"request"`, `"run"`, `"board"` or `"resync"`. Read everything on `null` and on `"resync"`: the screen may have missed something.

Narrowing the topic does the same job with less code. A screen subscribed to `topic.session(id, { resource: "tasks" })` only hears changes to that board, so a long reply never wakes it.

## Task boards

A task board's change is announced on the session that filed the task, narrowed to the board, whichever session or process made the change. A conversation's delegate settles its task in a task session of its own, and the conversation's board screen still hears of it at once. Subscribe the conversation's topic narrowed to each board your read returns:

```ts
useSubscription(
  [topic.session(conversationId, { resource: "tasks" }), topic.session(conversationId, { resource: "plan" })],
  refresh,
  { pollIntervalMs: 3000 },
);
```

Workforce's `listTasks_tasks` read returns the conversation's board and its planning worker's own steps, which sit on the `plan` board, so a screen of that read subscribes both. A flow with no planning worker never announces anything on `plan`, so the extra topic costs nothing.

`BoardList` with `live` does this for you, for the one board it draws. Its `client` needs `subscribe` (see [A board as a list](/docs/workforce/ui#a-board-as-a-list)).

## Outside React

`useSubscription` wraps `fsd.subscribe`, which you can call directly:

```ts
const sub = fsd.subscribe([topic.session(sessionId), topic.org()], {
  onChange: () => void reload(),
  pollIntervalMs: 3000,
});

// when the view goes away
sub.close();
```

Every `subscribe` call on one client shares one connection.

## Which hosts push

| Host | What happens |
|------|--------------|
| `serve()` from `@flow-state-dev/node`, including `fsdev dev` and `fsdev serve` | One WebSocket per client carries the notices. |
| Vercel, Next.js, `createServerApp` alone (Lambda, Bun, Deno) | No push. The read runs every `pollIntervalMs`. |

You don't write different code for either. The client asks the server what it supports and picks.

`pollIntervalMs` is also the fallback on a push host. The read runs on that timer while the socket is down, and while the server process the socket reached can't hear changes made in other processes (see below). Leave it out and there is no timer at all: the read runs on a notice, a connect and a reconnect only.

## One process, several processes

Each server keeps a *change bus*, the `bus` slot of its stores profile (the stores you hand `createFlowState`; see [Store adapters](/docs/persistence/overview#store-adapters)). A bus that *crosses processes* hands a change made in one server process to every other one. The default bus lives in memory and reaches only its own process, so it doesn't cross processes. On it, a subscription with `pollIntervalMs` keeps reading on its timer between notices, even when you run a single process. On a bus that crosses processes, the timer stays off while the socket is up.

When several processes serve one address, give them all the same signing key, so a connection that lands on any of them is accepted:

```ts
await serve(flowstate, {
  host,
  pushSecret: process.env.FSD_PUSH_SECRET,
});
```

`serve()` reads `FSD_PUSH_SECRET` itself when you don't pass `pushSecret`. Without a shared key, a connection that lands on another process is refused, and the screen reads on its timer until a retry lands. `push: false` turns push off for a `serve()` host.

## Who hears what

Each topic is checked on the server when the connection opens, with the same check the matching read uses. The client asks through its own `fetcher`, so a bearer token your fetcher adds signs the connection in, and so does a cookie. A topic the caller may not read is left out, exactly as a session that doesn't exist is, and the screen never hears of it. With `pollIntervalMs`, the client asks for it again at each tick, so access given back starts working without a reload.

An open connection is not checked again. If someone loses access while their tab stays open, their reads are refused at once, and the connection can still say that something changed, never what, until it reconnects. The server closes every connection after an hour, and the reconnect checks again.

## Following a session's own items

To show the messages and items of a session as they land, use `useSession(sessionId, { live: true })` or `fsd.sessions.stream`, not a subscription. Those send the items themselves. A session topic on `useSubscription` is for other reads of the session, such as a flow read.

## See also

- [`fsd.subscribe`](/docs/api/client#fsdsubscribetopics-options) in the client API
- [`useSubscription`](/docs/api/react#usesubscriptiontopics-read-options) in the React API
- [Host adapters](/docs/server/host-adapters)
