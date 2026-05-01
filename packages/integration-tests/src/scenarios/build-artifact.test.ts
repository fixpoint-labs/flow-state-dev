/**
 * S3 — build-mode artifact creation.
 *
 * The mocked generator emits a `write-artifact` tool call followed by a
 * confirmation message. Verifies the runtime invokes the tool, the
 * upsertResource utility writes a session-scoped resource, and a
 * `resource_change` SSE event surfaces in the items stream.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import artifactFlow from "./fixtures/artifact-flow";
import { findMessage, findResourceChanges, messageText } from "../helpers/assertions";

describe("build-mode artifact creation", () => {
  it("populates an artifact resource and emits a resource_change item", async () => {
    const result = await testFlow({
      flow: artifactFlow,
      action: "build",
      userId: "test-user",
      input: { message: "Build me a hello world page" },
      generators: {
        "builder-generator": mockGenerator({
          name: "builder-generator",
          script: [
            {
              toolCalls: [
                {
                  toolCallId: "tc_1",
                  toolName: "write-artifact",
                  args: {
                    id: "index.html",
                    title: "index.html",
                    content: "<h1>Hello</h1>"
                  }
                }
              ]
            },
            { text: "Created index.html for you." }
          ]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const resourceChanges = findResourceChanges(result.items, "artifacts/");
    expect(resourceChanges.length).toBeGreaterThan(0);
    expect(resourceChanges[0].changeType).toMatch(/created|updated/);
    expect(resourceChanges[0].resourcePath).toContain("index.html");

    const assistantMsg = findMessage(result.items, "assistant");
    expect(assistantMsg).toBeDefined();
    expect(messageText(assistantMsg!)).toContain("index.html");
  });
});
