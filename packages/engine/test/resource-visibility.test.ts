/**
 * A flow's `resourceVisibility` rule narrows what core's model-facing
 * resource tools reach on a turn, on the real engine.
 *
 * Each tool is mounted as an action, the same block a model would call, and
 * run with `runAction`. The rule here is fixed per flow, which is all core
 * needs to prove: who the rule is computed from is the composing layer's.
 *
 * - a hidden document is absent from listing, search and the discovery
 *   door, and reading or writing it answers exactly as for a uri nothing
 *   registers;
 * - a read-only one is listed and read, and a write is refused as for a
 *   resource that isn't writable;
 * - an app's own tool built on core's lookup gets the same narrowing;
 * - with no rule, nothing changes.
 */
import {
  createManifestRegistry,
  defineFlow,
  defineResource,
  defineResourceCollection,
  discoveryTools,
  handler,
  readResourceContentTool,
  resolveResourceByUri,
  resourcesManifestSource,
  resourceSearchTools,
  resourceTools,
  writeResourceContentTool,
  type ResourceVisibilityRule
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, runAction } from "../src";

const ORG = "acme";

function document(ref: string) {
  return defineResource({
    ref,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    content: `# ${ref}\nthe ${ref} body`,
    llmReadable: true,
    llmWritable: true
  });
}

const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "org",
  stateSchema: z.object({ text: z.string().default("") }),
  llmReadable: true
});

/** handbook is read-only, payroll and the notes collection are hidden, ledger is visible. */
const narrowing: ResourceVisibilityRule = (_ctx, { name }) =>
  name === "handbook" ? "read-only" : name === "payroll" || name === "notes" ? "hidden" : "visible";

/** An app's own tool: open a resource by uri through core's lookup and say what it found. */
const peek = handler({
  name: "peek",
  inputSchema: z.object({ uri: z.string() }),
  execute: async ({ uri }, ctx) => {
    const ref = await resolveResourceByUri(uri, ctx);
    return { found: ref !== undefined };
  }
});

function boot(rule: ResourceVisibilityRule | undefined) {
  const { globResources, grepResourceContent } = resourceSearchTools();
  const { createResource } = resourceTools();
  const discover = discoveryTools(createManifestRegistry([resourcesManifestSource()])).discover;
  const flow = defineFlow({
    kind: "docs",
    resources: { handbook: document("handbook"), payroll: document("payroll"), ledger: document("ledger"), notes },
    ...(rule !== undefined ? { resourceVisibility: rule } : {}),
    actions: {
      read: { inputSchema: z.object({ uri: z.string().optional() }), block: readResourceContentTool() },
      write: { inputSchema: z.object({ uri: z.string(), content: z.string() }), block: writeResourceContentTool() },
      glob: { inputSchema: z.object({}).passthrough(), block: globResources },
      grep: { inputSchema: z.object({ pattern: z.string() }).passthrough(), block: grepResourceContent },
      create: { inputSchema: z.object({ path: z.string() }), block: createResource },
      discover: { inputSchema: z.object({}).passthrough(), block: discover },
      peek: { inputSchema: z.object({ uri: z.string() }), block: peek }
    }
  });
  const instance = flow() as unknown as FlowInstance;
  const state = createFlowState({ flows: { docs: instance }, stores: { default: { primary: inMemoryStores() } } });
  const call = async (actionName: string, input: unknown) => {
    const runtime = await state.getRuntime();
    const result = await runAction({
      orgId: ORG,
      flow: instance,
      actionName,
      input,
      userId: "alice",
      sessionId: "s1",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    return { output: result.output as any, error: result.error === undefined ? undefined : String((result.error as Error).message ?? result.error) };
  };
  return { call, dispose: () => state.dispose() };
}

describe("resourceVisibility", () => {
  it("hides a resource from listing, search, discovery, reading, writing and an app's own lookup, as if unregistered", async () => {
    const { call, dispose } = await boot(narrowing);
    try {
      expect((await call("read", {})).output.uris).toEqual(["org/handbook", "org/ledger"]);
      expect((await call("glob", {})).output.uris).toEqual(["org/handbook", "org/ledger"]);
      const grep = (await call("grep", { pattern: "body" })).output.matches.map((m: { uri: string }) => m.uri);
      expect([...new Set(grep)].sort()).toEqual(["org/handbook", "org/ledger"]);
      const discovered = JSON.stringify((await call("discover", {})).output);
      expect(discovered).toContain("org/ledger");
      expect(discovered).not.toContain("org/payroll");

      // Named, the hidden one answers exactly as a uri nothing registers.
      const hidden = await call("read", { uri: "org/payroll" });
      const missing = await call("read", { uri: "org/nothing" });
      expect(hidden.error).toBe(missing.error?.replace("org/nothing", "org/payroll"));
      const hiddenWrite = await call("write", { uri: "org/payroll", content: "x" });
      const missingWrite = await call("write", { uri: "org/nothing", content: "x" });
      expect(hiddenWrite.error).toBe(missingWrite.error?.replace("org/nothing", "org/payroll"));
      expect((await call("peek", { uri: "org/payroll" })).output).toEqual({ found: false });
      // A hidden collection takes no writes either, and says so as for a path nothing matches.
      const hiddenCreate = await call("create", { path: "notes/a" });
      const missingCreate = await call("create", { path: "nowhere/a" });
      expect(hiddenCreate.error).toBe(missingCreate.error?.replace("nowhere/a", "notes/a"));
    } finally {
      await dispose();
    }
  });

  it("lets a read-only resource be read and refuses its write as for one that isn't writable", async () => {
    const { call, dispose } = await boot(narrowing);
    try {
      expect((await call("read", { uri: "org/handbook" })).output.content).toContain("the handbook body");
      expect((await call("write", { uri: "org/handbook", content: "rewritten" })).error).toBe(
        "Writable resource not found for uri: org/handbook"
      );
      expect((await call("read", { uri: "org/handbook" })).output.content).toContain("the handbook body");
      // The visible one is written.
      expect((await call("write", { uri: "org/ledger", content: "updated" })).error).toBeUndefined();
      expect((await call("read", { uri: "org/ledger" })).output.content).toBe("updated");
    } finally {
      await dispose();
    }
  });

  it("changes nothing when the flow sets no rule", async () => {
    const { call, dispose } = await boot(undefined);
    try {
      expect((await call("read", {})).output.uris).toEqual(["org/handbook", "org/ledger", "org/payroll"]);
      expect((await call("read", { uri: "org/payroll" })).output.content).toContain("the payroll body");
      expect((await call("write", { uri: "org/handbook", content: "rewritten" })).error).toBeUndefined();
      expect((await call("peek", { uri: "org/payroll" })).output).toEqual({ found: true });
      expect((await call("create", { path: "notes/a" })).error).toBeUndefined();
    } finally {
      await dispose();
    }
  });
});
