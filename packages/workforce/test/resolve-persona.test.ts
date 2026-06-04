import { describe, it, expect } from "vitest";
import { resolveAgentPersona } from "../src/resolve-persona";
import type { BlockContext } from "@flow-state-dev/core/types";

function makeCtxWithResources(
  resources: Array<{ path: string; content: string }>,
): BlockContext {
  const entries = resources.map((r) => ({
    path: r.path,
    scope: "org",
    uri: `org/${r.path}`,
    state: {},
    readContent: async () => r.content,
    readContentRaw: async () => r.content,
  }));

  return {
    resources: {
      list: () => entries as any,
      get: ((name: string) => entries.find((e) => e.path === name)) as any,
    },
  } as unknown as BlockContext;
}

describe("resolveAgentPersona", () => {
  it("returns a bare string verbatim", async () => {
    const ctx = makeCtxWithResources([]);
    const result = await resolveAgentPersona("You are an analyst.", ctx);
    expect(result).toBe("You are an analyst.");
  });

  it("renders an inline template with state", async () => {
    const ctx = makeCtxWithResources([]);
    const result = await resolveAgentPersona(
      { template: "Hello {{ state.name }}", state: { name: "world" } },
      ctx,
    );
    expect(result).toBe("Hello world");
  });

  it("resolves a { path } persona from a single resource", async () => {
    const ctx = makeCtxWithResources([
      { path: "persona-analyst", content: "You are a data analyst." },
    ]);
    const result = await resolveAgentPersona(
      { path: "persona-analyst" },
      ctx,
    );
    expect(result).toBe("You are a data analyst.");
  });

  it("throws when { path } persona is not found", async () => {
    const ctx = makeCtxWithResources([]);
    await expect(
      resolveAgentPersona({ path: "nonexistent" }, ctx),
    ).rejects.toThrow("was not found");
  });

  it("throws when { path } persona resolves to null content", async () => {
    const ctx = {
      resources: {
        list: () => [
          {
            path: "persona-empty",
            scope: "org",
            readContent: async () => null,
          },
        ] as any,
        get: (() => undefined) as any,
      },
    } as unknown as BlockContext;
    await expect(
      resolveAgentPersona({ path: "persona-empty" }, ctx),
    ).rejects.toThrow("readContent() returned null");
  });
});
