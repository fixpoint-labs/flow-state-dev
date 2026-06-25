/**
 * Registration-time validation for the per-flow `schedules` config (FIX-440,
 * FIX-838). A schedule is an action in scheduled form: it carries the handler
 * `block` inline (the shared `ActionCore`), so validation requires a `block`
 * and there is no named-action reference to check. Static `input` is validated
 * against the handler block's own `inputSchema`. Covers `validateScheduleConfig`
 * directly and through `defineFlow`, plus the exposure invariant: a
 * schedule-only handler does NOT appear in `flow.actions`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import {
  defineScheduleBinding,
  validateScheduleConfig,
  validateSchedulesConfig,
  type ScheduleConfig
} from "../src/types/schedules";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

const baseSchedule: ScheduleConfig = {
  cron: "0 0 * * *",
  block: noopHandler
};

describe("validateScheduleConfig (static)", () => {
  it("accepts a minimal valid schedule carrying an inline block", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "daily",
        schedule: baseSchedule,
        origin: "static"
      })
    ).not.toThrow();
  });

  it("rejects an id that violates the static pattern", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "Has/Slash",
        schedule: baseSchedule,
        origin: "static"
      })
    ).toThrow(/invalid id/);
  });

  it("rejects a cron expression that cron-parser cannot parse", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "bad-cron",
        schedule: { ...baseSchedule, cron: "this is not cron" },
        origin: "static"
      })
    ).toThrow(/invalid cron expression/);
  });

  it("rejects a schedule with no block", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "ghost",
        schedule: { cron: "0 0 * * *" } as unknown as ScheduleConfig,
        origin: "static"
      })
    ).toThrow(/must declare a `block`/);
  });

  it("rejects static input that violates the handler block's inputSchema", () => {
    const strictHandler = handler({
      name: "strict",
      inputSchema: z.object({ value: z.string() }),
      execute: () => undefined
    });

    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "bad-input",
        schedule: { cron: "0 0 * * *", block: strictHandler, input: { value: 42 } },
        origin: "static"
      })
    ).toThrow(/does not match/);
  });

  it("validates static input against the binding's inputSchema override", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "override-input",
        schedule: {
          cron: "0 0 * * *",
          block: noopHandler,
          inputSchema: z.object({ value: z.string() }),
          input: { value: 42 }
        } as unknown as ScheduleConfig,
        origin: "static"
      })
    ).toThrow(/does not match/);
  });

  it("accepts a function input without invoking it at registration", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "fn-input",
        schedule: { ...baseSchedule, input: () => ({ value: "x" }) },
        origin: "static"
      })
    ).not.toThrow();
  });

  it("rejects an unsupported onOverlap value", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "bad-overlap",
        // queue is reserved but not implemented in v1
        schedule: { ...baseSchedule, onOverlap: "queue" as unknown as ScheduleConfig["onOverlap"] },
        origin: "static"
      })
    ).toThrow(/unsupported onOverlap value/);
  });

  it("rejects a principal with an empty userId", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "bad-principal",
        schedule: { ...baseSchedule, principal: { userId: "" } },
        origin: "static"
      })
    ).toThrow(/invalid principal/);
  });
});

describe("validateScheduleConfig (dynamic origin)", () => {
  it("permits ids with slashes and colons that the static pattern rejects", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "user/abc123/weekly-digest",
        schedule: baseSchedule,
        origin: "dynamic"
      })
    ).not.toThrow();

    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "agent-followup:lead-456",
        schedule: baseSchedule,
        origin: "dynamic"
      })
    ).not.toThrow();
  });

  it("still rejects a missing block on a dynamic schedule", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "user/abc/x",
        schedule: { cron: "0 0 * * *" } as unknown as ScheduleConfig,
        origin: "dynamic"
      })
    ).toThrow(/must declare a `block`/);
  });

  it("still rejects an invalid cron on a dynamic schedule", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "user/abc/x",
        schedule: { ...baseSchedule, cron: "@everynow" },
        origin: "dynamic"
      })
    ).toThrow(/invalid cron expression/);
  });
});

describe("validateSchedulesConfig", () => {
  it("is a no-op when schedules is undefined", () => {
    expect(() => validateSchedulesConfig("demo", undefined)).not.toThrow();
  });

  it("is a no-op when only a resolver is provided", () => {
    expect(() => validateSchedulesConfig("demo", { resolve: () => null })).not.toThrow();
  });

  it("validates every static entry", () => {
    expect(() =>
      validateSchedulesConfig("demo", {
        static: {
          ok: { cron: "0 0 * * *", block: noopHandler },
          bad: { cron: "this is not cron", block: noopHandler }
        }
      })
    ).toThrow(/invalid cron expression/);
  });
});

describe("defineScheduleBinding", () => {
  it("is an identity passthrough returning the schedule config", () => {
    const binding = defineScheduleBinding({ cron: "0 9 * * *", block: noopHandler });
    expect(binding.cron).toBe("0 9 * * *");
    expect(binding.block).toBe(noopHandler);
  });
});

describe("defineFlow with schedules", () => {
  it("accepts a flow with a valid static schedule carrying an inline block", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {},
        schedules: {
          static: {
            "daily-digest": {
              cron: "0 9 * * *",
              block: noopHandler,
              description: "Sends the daily digest at 9am"
            }
          }
        }
      })
    ).not.toThrow();
  });

  it("throws synchronously at defineFlow time on bad cron", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {},
        schedules: {
          static: {
            broken: { cron: "@nope", block: noopHandler }
          }
        }
      })
    ).toThrow(/invalid cron expression/);
  });

  it("throws when a static schedule has no block", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {},
        // @ts-expect-error — block is required on a schedule binding
        schedules: { static: { ghost: { cron: "0 0 * * *" } } }
      })
    ).toThrow(/must declare a `block`/);
  });

  it("keeps a schedule-only handler out of flow.actions (no caller surface)", () => {
    const flow = defineFlow({
      kind: "demo",
      actions: {},
      schedules: { static: { daily: { cron: "0 0 * * *", block: noopHandler } } }
    });
    expect(Object.keys(flow.actions)).toHaveLength(0);
    expect(flow.actions).not.toHaveProperty("noop");
  });

  it("preserves schedules on the resulting FlowType", () => {
    const flow = defineFlow({
      kind: "demo",
      actions: {},
      schedules: {
        static: { daily: { cron: "0 0 * * *", block: noopHandler } },
        resolve: () => null
      }
    });

    expect(flow.schedules?.static?.daily?.cron).toBe("0 0 * * *");
    expect(typeof flow.schedules?.resolve).toBe("function");

    const inst = flow();
    expect(inst.schedules?.static?.daily?.block).toBe(noopHandler);
  });

  it("does not run the resolver at registration", () => {
    let resolveCalls = 0;
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {},
        schedules: {
          resolve: () => {
            resolveCalls += 1;
            return null;
          }
        }
      })
    ).not.toThrow();
    expect(resolveCalls).toBe(0);
  });
});
