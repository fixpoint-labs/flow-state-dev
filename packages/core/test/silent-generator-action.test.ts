/**
 * A caller action whose block is a generator with no `itemVisibility` emits no
 * items, so a chat UI mounted on it renders nothing and says nothing. Building
 * the flow warns once in dev, naming the flow, the action and both fixes; every
 * entry a caller cannot name, an explicit `itemVisibility`, and production stay
 * quiet, because a headless generator is legitimate there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow, generator, handler } from "../src";
import { __resetDeprecationWarningsForTests } from "../src/helpers/deprecation";
import type { TaskBinding } from "../src/types/dispatch";

const silent = () => generator({ name: "reply", model: "test-model", prompt: "p" });
const shown = () =>
  generator({ name: "reply", model: "test-model", prompt: "p", itemVisibility: { client: true, history: true } });

const passThrough: TaskBinding = { boardId: "issues", gate: (entry) => entry };

function warnings(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).filter((m: string) => m.includes("itemVisibility"));
}

describe("a generator mounted as a caller action with no itemVisibility", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    __resetDeprecationWarningsForTests();
    spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("warns once when the flow is built, naming the flow, the action and both fixes", () => {
    const flow = defineFlow({ kind: "support-desk", actions: { ask: { block: silent() } } });
    flow();
    flow();

    const found = warnings(spy);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"support-desk"');
    expect(found[0]).toContain('"ask"');
    expect(found[0]).toContain("itemVisibility: { client: true, history: true }");
    expect(found[0]).toContain("itemVisibility: { client: false, history: false }");
  });

  it("warns for an action an instance override adds", () => {
    const flow = defineFlow({ kind: "override-desk", actions: {} });
    flow({ actions: { late: { block: silent() } } } as never);
    expect(warnings(spy)).toHaveLength(1);
    expect(warnings(spy)[0]).toContain('"late"');
  });

  it("stays quiet when the generator sets itemVisibility", () => {
    defineFlow({ kind: "shown-desk", actions: { ask: { block: shown() } } })();
    expect(warnings(spy)).toHaveLength(0);
  });

  it("stays quiet on a handler action", () => {
    const h = handler({ name: "h", execute: () => ({ ok: true }) });
    defineFlow({ kind: "handler-desk", actions: { ask: { block: h } } })();
    expect(warnings(spy)).toHaveLength(0);
  });

  it("stays quiet on internal, task, webhook and schedule entries", () => {
    defineFlow({
      kind: "headless-desk",
      authentication: { defaultUserId: "system", requireUser: false },
      actions: {},
      internal: { actions: { wake: { block: silent() } } },
      // A pass-through gate, so the task entry's block is still the silent generator.
      task: { actions: { implement: { block: silent(), from: passThrough } } },
      webhooks: { stripe: { on: { "invoice.paid": { block: silent(), input: () => ({}) } } } },
      schedules: { static: { nightly: { block: silent(), cron: "0 3 * * *" } } }
    })();
    expect(warnings(spy)).toHaveLength(0);
  });

  it("stays quiet in production", () => {
    process.env.NODE_ENV = "production";
    defineFlow({ kind: "prod-desk", actions: { ask: { block: silent() } } })();
    expect(warnings(spy)).toHaveLength(0);
  });
});
