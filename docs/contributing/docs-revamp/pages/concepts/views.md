---
title: Views
type: concept
description: A view is what a screen reads. The server computes its answer when asked, and the screen asks again when anything the view read changes.
---

import Figure from "@site/src/components/Figure";
import ScreenAsks from "./figures/a-screen-asks.svg";
import WhatRefreshes from "./figures/what-refreshes.svg";

# Views

A view is what a screen reads. The screen asks, the server runs a block (a typed step of server code) that reads the stored data and works out the answer, and the screen shows it. The answer is not stored anywhere. It is computed each time, and the screen asks again when something the view read has changed.

The example on this page is the sidebar of a Workforce app, which lists the workers a user has hired. The data is stored. The view is the question the sidebar asks of it.

<Figure svg={ScreenAsks} caption="A screen asks, a view answers" description={"Three columns, left to right. On the left, the sidebar screen, which calls useView with rosterView and shows engineering.lead, analyst and writer. In the middle, the roster view, highlighted as the thing that stores nothing; inside it a dashed box holds its answer, the same three names, because the answer lasts only for the ask. On the right, the stored data, hatched because it outlives the request: workers hired by the user, one row each, and the standard workers from their WORKER.md files. An arrow runs from the sidebar to the view for the ask, and another from the view to the data for the read. Notes say the view runs its block and answers, and that the answer is kept nowhere while the workers stay where they are stored."} />

## If you know queries

A view is a typed read, much like a query. A screen asks, the server computes from stored data, and a hook holds the answer.

The difference is refreshing. The screen never names what should make it refresh; it refreshes when data the view read changes.

## Declaring the view

A view is a block with a scope and, for a list, a key for each row. Workforce ships a roster view like this one. Here is a small one declared by hand.

```ts title="src/flows/team/views/roster.ts"
import { defineView } from "@flow-state-dev/core";
import { rosterBlock } from "../blocks/roster-block";

export const roster = defineView({
  scope: "user",
  key: (row) => row.id,
  block: rosterBlock,
});
```

`rosterBlock` is a handler that lists the user's workers. It declares an output schema, which types the answer: the screen never holds an `unknown`. `scope: "user"` means each user is answered from their own rows. `key` returns a row's id, and the rows of one answer must have distinct ids. The [Views reference](../reference/views.md) lists every option.

A flow lists its views by name:

```ts title="src/flows/team/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { roster } from "./views/roster";

export default defineFlow({
  kind: "team",
  actions: {},
  views: { roster },
})();
```

## Reading it

A screen holds a reference to the view, built from the flow's `kind` first and then the view's name, and passes it to `useView`.

```tsx title="src/app/sidebar.tsx"
import { viewRef } from "@flow-state-dev/client";
import { useView } from "@flow-state-dev/react";
import type { roster } from "../flows/team/views/roster";

const rosterView = viewRef<typeof roster>("team", "roster");

export function Sidebar() {
  const { value, stale } = useView(rosterView);
  if (value === undefined) return <p>Loading</p>;
  return (
    <ul data-stale={stale}>
      {value.map((worker) => (
        <li key={worker.id}>{worker.name}</li>
      ))}
    </ul>
  );
}
```

`viewRef` takes the view's type, so the screen never imports the block. `value` is `undefined` until the first answer lands, then the typed rows. `stale` is `true` while the last read has failed, and the hook retries on its own. The [reference](../reference/views.md) covers the rest of what `useView` returns.

## When it updates

<Figure svg={WhatRefreshes} caption="What makes a view refresh" description={"Three boxes joined by arrows that read then. On the left, the stored workers, hatched because they outlive the request, with a new row, reviewer, hired just now: a write lands in the data. In the middle, the roster view is asked again, because it read the workers, so the write reaches it and its block runs again. On the right, the sidebar shows the new answer, with the reviewer row highlighted as the changed row. A note says the screen names no topic: the screen refreshes when data the view read changes."} />

Hire a reviewer, and the sidebar gains a row. Nothing in the screen says so. A change to the workers the view read reaches every screen watching it, and the view is asked again. The [reference](../reference/views.md) lists which writes count.

## Whose rows

Alice and Bob watch the same view and get different answers. A `user` view answers each user from their own rows, and a hire by Bob doesn't refresh Alice's sidebar. The [reference](../reference/views.md) lists the scopes.

The roster shows what "their own rows" means when the answer joins two stores. It lists the user's own workers and the standard workers, read from the `WORKER.md` files that ship with the app. The server joins them, so the screen never merges lists or removes a duplicate.

Say Alice edits a standard worker. It appears once in her roster, as her copy, still marked `standard: true` and still on the standard file's team, now with `edited: true`. The edited copy lives in Alice's own collection. Bob has not edited it, so his roster lists the unedited standard worker.

## What it gets you

- **No refresh code.** The sidebar calls `useView` once and a hire redraws it.
- **A typed answer.** `value` has the type of the block's output schema.
- **Watching is safe.** A view can write nothing and call no model, so a screen that watches it cannot change the data or run up a bill.
- **Per-user answers.** Each user sees their own rows.

## How it fits with the others

A resource stores the data a view reads. The view stores nothing, which is why a list computed from several collections, such as the roster, is a view and the collections underneath are resources. An action is what a screen asks the server to do. A view cannot dispatch one.

## Next

- [Views reference](../reference/views.md) lists every option, the scopes, row keys and what a view refuses.
- [Resources](./resources.md) covers the stored data a view reads.
- [Flows and actions](./flows-and-actions.md) covers what a screen asks the server to do.
