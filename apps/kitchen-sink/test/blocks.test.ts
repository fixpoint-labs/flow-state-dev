import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, executeBlock } from "@flow-state-dev/server";
import {
  readArtifact,
  updateArtifact
} from "../flows/chat-agent/blocks";
import { artifactsCollection } from "../flows/chat-agent/blocks/artifacts";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

type ArtifactState = { title: string; summary: string; updatedAt: number };

// Build a minimal flow with the artifacts collection so the execution context
// creates proper ResourceCollectionRef instances.
function makeTestFlow() {
  const block = handler({
    name: "noop",
    resources: { artifacts: artifactsCollection },
    execute: () => "ok",
  });

  return defineFlow({
    kind: "blocks-test",
    actions: { run: { inputSchema: z.string(), block } },
  })();
}

async function createCtx() {
  const stores = createInMemoryStores();
  const flow = makeTestFlow();
  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores,
  });
  return { ctx, stores };
}

describe("chat-agent blocks", () => {
  it("readArtifact returns not-found for missing artifact", async () => {
    const { ctx } = await createCtx();

    const result = await executeBlock({
      block: readArtifact,
      input: { artifactId: "missing-id" },
      ctx,
    });

    const output = result.output as { id: string; title: string; content: string };
    expect(output.title).toBe("Not Found");
    expect(output.content).toBe("");
  });

  it("readArtifact returns artifact with content from resource content", async () => {
    const { ctx } = await createCtx();

    // Seed an artifact: metadata in state, body in content
    const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<ArtifactState>;
    const ref = await artifacts.create("doc-1", {
      title: "Seeded Doc",
      summary: "",
      updatedAt: 1000,
    });
    await ref.writeContent("Seeded content");

    const result = await executeBlock({
      block: readArtifact,
      input: { artifactId: "doc-1" },
      ctx,
    });

    const output = result.output as { id: string; title: string; content: string };
    expect(output.title).toBe("Seeded Doc");
    expect(output.content).toBe("Seeded content");
  });

  it("updateArtifact creates a new artifact with content", async () => {
    const { ctx } = await createCtx();

    const result = await executeBlock({
      block: updateArtifact,
      input: {
        id: "new-doc",
        title: "New Document",
        content: "Fresh content",
      },
      ctx,
    });

    const output = result.output as { id: string; title: string; content: string };
    expect(output.id).toBe("new-doc");
    expect(output.title).toBe("New Document");

    // Verify: metadata in state, body in content
    const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<ArtifactState>;
    const ref = await artifacts.get("new-doc");
    expect((ref.state).title).toBe("New Document");
    const content = await ref.readContent();
    expect(content).toBe("Fresh content");
  });

  it("updateArtifact updates an existing artifact", async () => {
    const { ctx } = await createCtx();

    await executeBlock({
      block: updateArtifact,
      input: { id: "doc-1", title: "Original", content: "v1" },
      ctx,
    });

    await executeBlock({
      block: updateArtifact,
      input: { id: "doc-1", title: "Revised", content: "v2" },
      ctx,
    });

    const artifacts = ctx.resources.artifacts as unknown as ResourceCollectionRef<ArtifactState>;
    const ref = await artifacts.get("doc-1");
    expect((ref.state).title).toBe("Revised");
    const content = await ref.readContent();
    expect(content).toBe("v2");
  });
});
