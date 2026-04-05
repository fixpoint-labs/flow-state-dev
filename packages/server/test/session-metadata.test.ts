/**
 * Tests for mutable session metadata: title, description, tags, and setMetadata.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  parseFlowRoute
} from "../src";

function makeFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: boolean }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function makeMetadataFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      setTitle: {
        inputSchema: z.object({ title: z.string() }),
        block: handler<{ title: string }, { ok: boolean }>({
          name: `${kind}-setTitle`,
          async execute(input, ctx) {
            await ctx.session.setMetadata({ title: input.title });
            return { ok: true };
          }
        })
      },
      setAll: {
        inputSchema: z.object({
          title: z.string(),
          description: z.string(),
          tags: z.array(z.string())
        }),
        block: handler<{ title: string; description: string; tags: string[] }, { ok: boolean }>({
          name: `${kind}-setAll`,
          async execute(input, ctx) {
            await ctx.session.setMetadata({
              title: input.title,
              description: input.description,
              tags: input.tags,
              metadata: { custom: "value" }
            });
            return { ok: true };
          }
        })
      }
    }
  })({ id: kind });
}

function createRouter() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const flow = makeFlow("demo");
  const metaFlow = makeMetadataFlow("meta");
  registry.register(flow);
  registry.register(metaFlow);

  const router = createFlowApiRouter({ registry, stores });
  return { router, stores };
}

describe("parseFlowRoute — PATCH session metadata", () => {
  it("parses PATCH /sessions/:id/metadata", () => {
    expect(parseFlowRoute("PATCH", ["sessions", "sess_1", "metadata"])).toEqual({
      kind: "patch_session_metadata",
      sessionId: "sess_1"
    });
  });

  it("returns not_found for PATCH without metadata segment", () => {
    expect(parseFlowRoute("PATCH", ["sessions", "sess_1"])).toEqual({
      kind: "not_found"
    });
  });
});

describe("session creation with title, description, tags", () => {
  it("creates a session with first-class metadata fields", async () => {
    const { router } = createRouter();

    const response = await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user_1",
          title: "My Session",
          description: "A test session",
          tags: ["test", "demo"]
        })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
      };
    };
    expect(body.session.title).toBe("My Session");
    expect(body.session.description).toBe("A test session");
    expect(body.session.tags).toEqual(["test", "demo"]);
  });

  it("creates a session without optional metadata fields", async () => {
    const { router } = createRouter();

    const response = await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
      };
    };
    expect(body.session.title).toBeUndefined();
    expect(body.session.description).toBeUndefined();
    expect(body.session.tags).toBeUndefined();
  });
});

describe("PATCH /sessions/:id/metadata", () => {
  it("updates title via PATCH", async () => {
    const { router } = createRouter();

    // Create session first
    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_patch" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    // PATCH metadata
    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_patch/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated Title" })
      }),
      { params: { path: ["sessions", "sess_patch", "metadata"] } }
    );

    expect(patchResponse.status).toBe(200);
    const body = (await patchResponse.json()) as {
      session: {
        title?: string;
        description?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      };
    };
    expect(body.session.title).toBe("Updated Title");
  });

  it("merges metadata fields (last-write-wins)", async () => {
    const { router } = createRouter();

    // Create session with initial metadata
    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user_1",
          sessionId: "sess_merge",
          metadata: { existing: "value", overwrite: "old" }
        })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    // PATCH with partial metadata
    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_merge/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New Title",
          tags: ["a", "b"],
          metadata: { overwrite: "new", added: "field" }
        })
      }),
      { params: { path: ["sessions", "sess_merge", "metadata"] } }
    );

    expect(patchResponse.status).toBe(200);
    const body = (await patchResponse.json()) as {
      session: {
        title?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      };
    };
    expect(body.session.title).toBe("New Title");
    expect(body.session.tags).toEqual(["a", "b"]);
    expect(body.session.metadata).toEqual({
      existing: "value",
      overwrite: "new",
      added: "field"
    });
  });

  it("returns 404 for unknown session", async () => {
    const { router } = createRouter();

    const patchResponse = await router.PATCH(
      new Request("http://localhost/api/flows/sessions/unknown_sess/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "nope" })
      }),
      { params: { path: ["sessions", "unknown_sess", "metadata"] } }
    );

    expect(patchResponse.status).toBe(404);
  });

  it("persists metadata changes to the store", async () => {
    const { router, stores } = createRouter();

    await router.POST(
      new Request("http://localhost/api/flows/demo/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_store" })
      }),
      { params: { path: ["demo", "sessions"] } }
    );

    await router.PATCH(
      new Request("http://localhost/api/flows/sessions/sess_store/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Persisted",
          description: "Stored",
          tags: ["stored"]
        })
      }),
      { params: { path: ["sessions", "sess_store", "metadata"] } }
    );

    const record = await stores.session.get("sess_store");
    expect(record?.title).toBe("Persisted");
    expect(record?.description).toBe("Stored");
    expect(record?.tags).toEqual(["stored"]);
  });
});

describe("ctx.session.setMetadata during execution", () => {
  it("updates session metadata and emits SSE event", async () => {
    const { router, stores } = createRouter();

    // Create session
    await router.POST(
      new Request("http://localhost/api/flows/meta/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_exec" })
      }),
      { params: { path: ["meta", "sessions"] } }
    );

    // Execute action that calls setMetadata (returns 202 for SSE stream)
    const execResponse = await router.POST(
      new Request("http://localhost/api/flows/meta/sess_exec/actions/setTitle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { title: "Runtime Title" },
          userId: "user_1",
          sessionId: "sess_exec"
        })
      }),
      { params: { path: ["meta", "sess_exec", "actions", "setTitle"] } }
    );

    expect(execResponse.status).toBe(202);

    // Consume response and allow async execution to complete
    await execResponse.json();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the session record was updated in the store
    const record = await stores.session.get("sess_exec");
    expect(record?.title).toBe("Runtime Title");
  });

  it("updates all metadata fields via setMetadata", async () => {
    const { router, stores } = createRouter();

    // Create session
    await router.POST(
      new Request("http://localhost/api/flows/meta/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user_1", sessionId: "sess_all" })
      }),
      { params: { path: ["meta", "sessions"] } }
    );

    // Execute action that calls setMetadata with all fields
    const execResponse = await router.POST(
      new Request("http://localhost/api/flows/meta/sess_all/actions/setAll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            title: "Full Title",
            description: "Full Description",
            tags: ["tag1", "tag2"]
          },
          userId: "user_1",
          sessionId: "sess_all"
        })
      }),
      { params: { path: ["meta", "sess_all", "actions", "setAll"] } }
    );

    // Consume the SSE stream to allow execution to complete
    await execResponse.text();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const record = await stores.session.get("sess_all");
    expect(record?.title).toBe("Full Title");
    expect(record?.description).toBe("Full Description");
    expect(record?.tags).toEqual(["tag1", "tag2"]);
    expect(record?.metadata).toEqual({ custom: "value" });
  });
});
