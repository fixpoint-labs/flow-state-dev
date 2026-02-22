import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  readArtifact,
  updateArtifact
} from "../src/flows/kitchen-sink/blocks";

describe("kitchen-sink blocks", () => {
  it("readArtifact returns not-found for missing artifact", async () => {
    const result = await testBlock(readArtifact, {
      input: { artifactId: "missing-id" },
      session: {
        resources: {
          artifacts: { byId: {}, order: [] }
        }
      }
    });

    expect(result.output.title).toBe("Not Found");
    expect(result.output.content).toBe("");
  });

  it("readArtifact returns artifact from seeded resource", async () => {
    const result = await testBlock(readArtifact, {
      input: { artifactId: "doc-1" },
      session: {
        resources: {
          artifacts: {
            byId: {
              "doc-1": {
                id: "doc-1",
                title: "Seeded Doc",
                content: "Seeded content",
                updatedAt: 1000
              }
            },
            order: ["doc-1"]
          }
        }
      }
    });

    expect(result.output.title).toBe("Seeded Doc");
    expect(result.output.content).toBe("Seeded content");
  });

  it("updateArtifact writes to artifacts resource", async () => {
    const result = await testBlock(updateArtifact, {
      input: {
        id: "new-doc",
        title: "New Document",
        content: "Fresh content"
      },
      session: {
        resources: {
          artifacts: { byId: {}, order: [] }
        }
      }
    });

    expect(result.output.success).toBe(true);
    expect(result.output.id).toBe("new-doc");
  });
});
