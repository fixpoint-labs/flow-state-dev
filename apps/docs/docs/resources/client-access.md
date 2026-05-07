---
sidebar_position: 4
---

# Client Access

Resources live on the server. By default, clients can't see them. The `client` config on a resource definition controls what's visible and what operations are allowed.

This is separate from scope-level `clientData`. Scope clientData computes derived values from state and passes them to the frontend as a flat projection. Resource client access gives the frontend direct, lazy-loaded access to resource content and metadata through dedicated endpoints and React hooks.

## Declaring visibility

Add a `client` property to `defineResource()` or `defineResourceCollection()`:

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const soulResource = defineResource({
  stateSchema: z.object({
    values: z.array(z.string()).default([]),
    tone: z.string().default("balanced"),
  }),
  content: "## Core Values\n...",
  client: {
    content: { read: true },
    data: (state) => ({
      tone: state.tone,
      valueCount: state.values.length,
    }),
  },
});
```

Without a `client` property, the resource is invisible to clients. Adding it opens two channels:

- **`content`** controls access to the resource's content body (the "file" part)
- **`data`** derives metadata from state, available immediately in the session snapshot

### Content permissions

The `content` object determines what clients can do with the content body:

| Permission | Effect |
|-----------|--------|
| `read` | Client can fetch content via `fetchContent()` |
| `prefetch` | Content is included inline in the state snapshot (no separate fetch needed) |

For collections, two additional permissions control mutations:

| Permission | Effect |
|-----------|--------|
| `create` | Client can create new items via `POST` |
| `update` | Client can modify item content via `PATCH` |
| `delete` | Client can remove items via `DELETE` |

### The data function

`data` is a function that takes the resource's state and returns whatever you want clients to see. It runs server-side when the snapshot is built. Clients get the result, never the raw state.

```ts
client: {
  data: (state) => ({
    title: state.title,
    updatedAt: state.updatedAt,
    // state.internalNotes is NOT exposed
  }),
}
```

Omit `data` if you only need content access and don't need metadata in the snapshot.

## Collection example

Collections are where client access gets the most use. A typical artifact or file collection exposes metadata for listing and content for viewing:

```ts
const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  stateSchema: z.object({
    title: z.string(),
    summary: z.string().default(""),
    updatedAt: z.number(),
  }),
  client: {
    content: { read: true, update: true },
    state: { read: true },
    data: (state) => ({
      title: state.title,
      summary: state.summary,
      updatedAt: state.updatedAt,
    }),
  },
});
```

The snapshot carries the collection's total item count and (when `prefetchWindow` is set) an inline window of the first N items. Per-item `clientData` is included in that window only when `client.state.read: true` is set. Clients page through the rest via the list endpoint or `useResourceCollectionList`. Content is not included; it's fetched per item on demand. See [Resource Collections — lazy state](/docs/resources/collections#lazy-state-by-default) for the full mental model.

## client.state

Collections (only — single resources gate state via `data` directly) can opt into a separate state-read permission:

```ts
client: {
  content: { read: true, update: true },
  state: { read: true },
}
```

What `client.state.read: true` enables:

- The list endpoint (`GET /sessions/:id/resources/:ref?limit=…`) and the single-item state endpoint succeed; the response carries each item's `clientData`.
- The snapshot's `prefetched` window includes `clientData` for each prefetched item.

Without it, those endpoints return 403 and `prefetched` carries just the `topic` for each item. The collection's `count` is always emitted regardless — counts are a cardinality affordance, not state.

For capability-driven UIs, the [resource manifest](/docs/resources/manifest) reports declared permissions per resource so clients can render conditional affordances without hard-coding flow knowledge.

## Snapshot shape

When you request session state, resources with `client` config appear under a `resources` key:

```json
{
  "clientData": { "session": { "modeStatus": { ... } } },
  "resources": {
    "session": {
      "artifacts": {
        "items": {
          "artifacts/readme.md": {
            "clientData": { "title": "README", "summary": "Project overview", "updatedAt": 1712000000 }
          },
          "artifacts/spec.md": {
            "clientData": { "title": "Spec", "summary": "Technical specification", "updatedAt": 1712001000 }
          }
        }
      }
    }
  }
}
```

Collection items are keyed by their full storage path. Single resources appear directly under their name without an `items` wrapper. Resources without `client` config don't appear at all.

### Prefetch

For small resources that clients always need, `prefetch: true` inlines the content:

```ts
client: {
  content: { read: true, prefetch: true },
  data: (state) => ({ tone: state.tone }),
}
```

The snapshot then includes a `content` field alongside `clientData`:

```json
{
  "soul": {
    "clientData": { "tone": "balanced" },
    "content": "## Core Values\n..."
  }
}
```

Skip prefetch for collections with many items or large content bodies. The default lazy approach fetches content for one item at a time when the user actually needs it.

## React hooks

The `@flow-state-dev/react` package provides three hooks for working with client-visible resources.

### useResource

For single resources. Metadata is available immediately from the snapshot. Content is fetched on demand.

```tsx
import { useSession, useResource } from "@flow-state-dev/react";

function SoulPanel() {
  const session = useSession(sessionId);
  const { clientData, fetchContent } = useResource(session, "soul");

  const tone = (clientData as { tone: string })?.tone;
  const [content, setContent] = useState<string | null>(null);

  const handleOpen = async () => {
    const text = await fetchContent();
    setContent(text);
  };

  return (
    <div>
      <p>Tone: {tone}</p>
      <button onClick={handleOpen}>View content</button>
      {content && <pre>{content}</pre>}
    </div>
  );
}
```

If the resource declared `prefetch: true`, `fetchContent()` returns the cached snapshot content without a network request.

### useResourceContent

Convenience wrapper that fetches content immediately on mount. Use this when you know the content is always needed.

```tsx
import { useResourceContent } from "@flow-state-dev/react";

function SoulDisplay() {
  const session = useSession(sessionId);
  const { clientData, content, isLoading, refetch } = useResourceContent(session, "soul");

  if (isLoading) return <p>Loading...</p>;
  return <pre>{content}</pre>;
}
```

`refetch()` re-fetches the content. The hook also refetches automatically when the session snapshot changes.

### useResourceCollection

For collections. Returns items (metadata from the snapshot) and CRUD actions shaped by the declared permissions.

```tsx
import { useResourceCollection } from "@flow-state-dev/react";

function ArtifactList() {
  const session = useSession(sessionId);
  const { items, actions } = useResourceCollection(session, "artifacts");

  return (
    <ul>
      {Object.entries(items).map(([key, item]) => {
        const data = item.clientData as { title: string; summary: string };
        return (
          <li key={key} onClick={() => openArtifact(key)}>
            <strong>{data.title}</strong>
            <span>{data.summary}</span>
          </li>
        );
      })}
    </ul>
  );
}

async function openArtifact(key: string) {
  const content = await items[key].fetchContent();
  // render content...
}
```

Each item in `items` has:
- `clientData` — the output of your `data` function
- `fetchContent()` — lazy content loader for that specific item

The `actions` object provides mutation methods based on your declared permissions:

```ts
// Create a new item (requires client.content.create)
await actions.create({ topic: "new-doc.md", content: "# New Document" });

// Update content (requires client.content.update)
await actions.update({ topic: "artifacts/readme.md", content: "# Updated" });

// Delete an item (requires client.content.delete)
await actions.delete({ topic: "artifacts/old.md" });
```

Actions that weren't declared in the resource's `client.content` config will return a 403 from the server.

## Non-React usage

The `@flow-state-dev/client` package exports `createResourceClient` for direct HTTP access without React:

```ts
import { createResourceClient } from "@flow-state-dev/client";

const resources = createResourceClient({ baseUrl: "/api" });

// Fetch content for a single resource
const { content } = await resources.getResourceContent(sessionId, "soul");

// Fetch content for a collection item
const { content } = await resources.getCollectionItemContent(sessionId, "artifacts", "artifacts/readme.md");

// Mutations
await resources.createCollectionItem(sessionId, "artifacts", { topic: "new.md", content: "..." });
await resources.updateResourceContent(sessionId, "artifacts", "artifacts/readme.md", { content: "..." });
await resources.deleteCollectionItem(sessionId, "artifacts", "artifacts/old.md");
```

## HTTP endpoints

Under the hood, these hooks and clients talk to these endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sessions/:id/resources/:ref/content` | Fetch single resource content |
| `GET` | `/sessions/:id/resources/:ref/:topic/content` | Fetch collection item content |
| `POST` | `/sessions/:id/resources/:ref` | Create collection item |
| `PATCH` | `/sessions/:id/resources/:ref/:topic/content` | Update item content |
| `DELETE` | `/sessions/:id/resources/:ref/:topic` | Delete collection item |

All paths are relative to `/api/flows`. Permissions are enforced server-side based on the resource's `client.content` config. Requests for resources without `client` config return 404.

## Live updates

When a resource changes during streaming (e.g., a tool creates an artifact), the server emits a `resource_change` SSE event. The React hooks handle this automatically: the session snapshot is refreshed after the request completes, and collection items update in place.

You don't need to poll or manually refetch. If an artifact is created mid-turn, it appears in `useResourceCollection`'s `items` once the turn finishes.

## Where to go next

- **[Resources Overview](/docs/resources/overview)** — Resource fundamentals, defineResource, content and state
- **[Resource Collections](/docs/resources/collections)** — Dynamic collections, patterns, eviction, lifecycle hooks
- **[Client Overview](/docs/client/overview)** — Session management, streaming, state snapshots
- **[Client > React](/docs/client/react)** — React hooks and component renderers
