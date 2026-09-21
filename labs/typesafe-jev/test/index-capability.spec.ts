/**
 * The index capability is optional. Helpers live on ctx.cap, not a
 * bag glued onto the capability object.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  SEARCH_INDEXED_DOCUMENTS_TOOL,
  createSystemOneIndexCapability,
  systemOneIndexTools,
} from "../src/index-capability";
import { INDEXED_DOCS, indexedDocsCollection } from "../src/indexed-docs-resource";
import { ingestInputSchema } from "../src/index-ops";
import type { TypeSafeRequest } from "../src/client";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

function facetResult(
  kind: string,
  topic: string,
  status: string,
  urgency: string,
  confidence = 0.9,
): TypeSafeEvaluateOutput {
  const choice = (value: string) => ({
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: confidence },
    confidence,
  });
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      kind: choice(kind),
      topic: choice(topic),
      status: choice(status),
      urgency: choice(urgency),
    },
  };
}

function byTitle(request: TypeSafeRequest): TypeSafeEvaluateOutput {
  const text = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
  if (text.includes("charge")) return facetResult("ticket", "billing", "open", "high");
  return facetResult("other", "other", "unknown", "normal");
}

describe("createSystemOneIndexCapability", () => {
  it("installs the collection and the facet search tool", () => {
    const { client } = scriptedClient(facetResult("ticket", "billing", "open", "high"));
    const cap = createSystemOneIndexCapability({ client });
    expect(cap.name).toBe("system-one-index");
    expect(cap.resources?.[INDEXED_DOCS]).toBe(indexedDocsCollection);
    expect(typeof cap.fns).toBe("function");
    expect(systemOneIndexTools(cap).map((tool) => tool.name)).toEqual([
      SEARCH_INDEXED_DOCUMENTS_TOOL,
    ]);
  });

  it("returns no tools when the capability was never created", () => {
    expect(systemOneIndexTools(undefined)).toEqual([]);
    expect(systemOneIndexTools(null)).toEqual([]);
  });

  it("exposes ingest / search on ctx.cap, not on the capability object", async () => {
    const { client, calls } = scriptedClient(byTitle);
    const cap = createSystemOneIndexCapability({ client });
    expect(cap).not.toHaveProperty("classifyOnWrite");
    expect(cap).not.toHaveProperty("searchTool");

    const viaCap = handler({
      name: "via-cap",
      uses: [cap.presets({ tools: false })],
      inputSchema: ingestInputSchema,
      outputSchema: z.object({
        key: z.string(),
        wrote: z.boolean(),
        facets: z.unknown().nullable(),
      }),
      execute: (input, ctx) => ctx.cap["system-one-index"].ingest(input),
    });

    const result = await testBlock(viaCap, {
      input: {
        key: "dup-charge",
        title: "Duplicate charge",
        body: "Card charged twice",
      },
    });
    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      key: "dup-charge",
      wrote: true,
      facets: { kind: "ticket", topic: "billing" },
    });
    expect(calls).toHaveLength(1);
  });
});
