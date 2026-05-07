---
sidebar_position: 5
---

# Resource Manifest

The manifest is a description of every public resource a session's flow exposes. For each resource it carries the kind (single vs. collection), the scope, the storage pattern (collections only), the configured `prefetchWindow`, and the declared client permissions.

It's static per `flowKind`. Two sessions on the same flow share the same manifest, so it's safe to fetch once and cache.

## When to use it

- **Capability-aware UIs.** Render a "Create" button only for collections that declare `client.content.create: true`. Hide an editor for resources without `client.content.update`.
- **DevTools.** Enumerate every public resource the session offers, including collections that have no items yet.
- **Runtime introspection.** Discover what's available at session bootstrap without reading the flow definition.

## When NOT to use it

The manifest deliberately doesn't carry:

- **Schemas** for `clientData` or content. TypeScript declarations are the canonical source. The manifest reports capabilities and shape kind, not data shapes.
- **Per-item data.** Use the list endpoint or `useResourceCollectionList` for collection items.
- **Runtime updates.** Manifests don't change while a session is running. They're flow-static.

## What's in a manifest

```ts
interface ResourceManifest {
  flowKind: string;
  resources: ResourceManifestEntry[];
}

interface ResourceManifestEntry {
  ref: string;
  kind: "single" | "collection";
  scope: "session" | "user" | "org";
  pattern?: string;          // collections only
  prefetchWindow?: number;   // collections only; 0 if unset
  hasClientData: boolean;    // whether the resource has a clientData projection
  client: {
    content?: {
      read?: boolean;
      prefetch?: boolean;
      create?: boolean;      // collections only
      update?: boolean;      // collections only
      delete?: boolean;      // collections only
    };
    state?: {
      read?: boolean;        // collections only
    };
  };
}
```

A resource appears in the manifest if and only if its `client` config opts into any client-visible affordance — a permission flag or a `data` projection. Resources without a `client` config are server-internal and not enumerated.

Example response:

```json
{
  "flowKind": "chat-agent",
  "resources": [
    {
      "ref": "artifacts",
      "kind": "collection",
      "scope": "session",
      "pattern": "artifacts/**",
      "prefetchWindow": 20,
      "hasClientData": true,
      "client": {
        "content": { "read": true, "update": true },
        "state": { "read": true }
      }
    },
    {
      "ref": "preferences",
      "kind": "single",
      "scope": "user",
      "hasClientData": true,
      "client": {}
    }
  ]
}
```

## React: useResourceManifest

```tsx
import { useResourceManifest } from "@flow-state-dev/react";

function CreateArtifactButton({ session }) {
  const { manifest } = useResourceManifest(session);
  const artifacts = manifest?.resources.find((r) => r.ref === "artifacts");
  const canCreate = artifacts?.client.content?.create === true;
  if (!canCreate) return null;
  return <Button onClick={openNewArtifact}>New artifact</Button>;
}
```

The hook fetches once per `flowKind` and shares the result across components via a module-level cache. Subsequent mounts of the same hook return the cached manifest immediately. SSE has no role here — manifests don't change at runtime.

## HTTP: GET /sessions/:id/manifest

```
GET /api/flows/sessions/:sessionId/manifest
```

Returns a `ResourceManifest`. The endpoint requires session existence (404 if unknown) but no further permission gate — the manifest is the public surface, by design. Cache the response by `flowKind`, not `sessionId`, so multiple sessions on the same flow share one fetch.

## What's NOT in the manifest

The manifest is intentionally small. It declares capabilities; it doesn't serialize schemas for `clientData` or content bodies. If apps grow a concrete need for typed schema discovery, that addition composes — the manifest shape is forward-compatible.
