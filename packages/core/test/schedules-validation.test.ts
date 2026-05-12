import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import {
  validateScheduleConfig,
  validateSchedulesConfig,
  type ScheduleConfig
} from "../src/types/schedules";
import type { ActionConfig } from "../src/types/flow";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

const actions: Record<string, ActionConfig> = {
  run: {
    block: noopHandler,
    inputSchema: z.object({ value: z.string().optional() })
  }
};

const baseSchedule: ScheduleConfig = {
  cron: "0 0 * * *",
  action: "run"
};

describe("validateScheduleConfig (static)", () => {
  it("accepts a minimal valid schedule", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "daily",
        schedule: baseSchedule,
        actions,
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
        actions,
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
        actions,
        origin: "static"
      })
    ).toThrow(/invalid cron expression/);
  });

  it("rejects an action that the flow does not declare", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "ghost",
        schedule: { ...baseSchedule, action: "missing" },
        actions,
        origin: "static"
      })
    ).toThrow(/no such action is declared/);
  });

  it("rejects static input that violates the action's inputSchema", () => {
    const strictActions: Record<string, ActionConfig> = {
      run: {
        block: noopHandler,
        inputSchema: z.object({ value: z.string() })
      }
    };

    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "bad-input",
        schedule: { ...baseSchedule, input: { value: 42 } },
        actions: strictActions,
        origin: "static"
      })
    ).toThrow(/does not match action/);
  });

  it("accepts a function input without invoking it at registration", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "fn-input",
        schedule: { ...baseSchedule, input: () => ({ value: "x" }) },
        actions,
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
        actions,
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
        actions,
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
        actions,
        origin: "dynamic"
      })
    ).not.toThrow();

    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "agent-followup:lead-456",
        schedule: baseSchedule,
        actions,
        origin: "dynamic"
      })
    ).not.toThrow();
  });

  it("still rejects an unknown action on a dynamic schedule", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "user/abc/x",
        schedule: { ...baseSchedule, action: "missing" },
        actions,
        origin: "dynamic"
      })
    ).toThrow(/no such action is declared/);
  });

  it("still rejects an invalid cron on a dynamic schedule", () => {
    expect(() =>
      validateScheduleConfig({
        kind: "demo",
        id: "user/abc/x",
        schedule: { ...baseSchedule, cron: "@everynow" },
        actions,
        origin: "dynamic"
      })
    ).toThrow(/invalid cron expression/);
  });
});

describe("validateSchedulesConfig", () => {
  it("is a no-op when schedules is undefined", () => {
    expect(() => validateSchedulesConfig("demo", undefined, actions)).not.toThrow();
  });

  it("is a no-op when only a resolver is provided", () => {
    expect(() =>
      validateSchedulesConfig("demo", { resolve: () => null }, actions)
    ).not.toThrow();
  });

  it("validates every static entry", () => {
    expect(() =>
      validateSchedulesConfig(
        "demo",
        {
          static: {
            ok: { cron: "0 0 * * *", action: "run" },
            bad: { cron: "this is not cron", action: "run" }
          }
        },
        actions
      )
    ).toThrow(/invalid cron expression/);
  });
});

describe("defineFlow with schedules", () => {
  it("accepts a flow with a valid static schedule", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {
          run: {
            block: noopHandler,
            inputSchema: z.object({ value: z.string().optional() })
          }
        },
        schedules: {
          static: {
            "daily-digest": {
              cron: "0 9 * * *",
              action: "run",
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
        actions: {
          run: {
            block: noopHandler,
            inputSchema: z.object({ value: z.string().optional() })
          }
        },
        schedules: {
          static: {
            broken: { cron: "@nope", action: "run" }
          }
        }
      })
    ).toThrow(/invalid cron expression/);
  });

  it("throws when a static schedule references an unknown action", () => {
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {
          run: {
            block: noopHandler,
            inputSchema: z.object({ value: z.string().optional() })
          }
        },
        schedules: {
          static: {
            ghost: { cron: "0 0 * * *", action: "missing" }
          }
        }
      })
    ).toThrow(/no such action is declared/);
  });

  it("preserves schedules on the resulting FlowType", () => {
    const flow = defineFlow({
      kind: "demo",
      actions: {
        run: {
          block: noopHandler,
          inputSchema: z.object({ value: z.string().optional() })
        }
      },
      schedules: {
        static: { daily: { cron: "0 0 * * *", action: "run" } },
        resolve: () => null
      }
    });

    expect(flow.schedules?.static?.daily?.cron).toBe("0 0 * * *");
    expect(typeof flow.schedules?.resolve).toBe("function");

    const inst = flow();
    expect(inst.schedules?.static?.daily?.action).toBe("run");
  });

  it("does not run the resolver at registration", () => {
    let resolveCalls = 0;
    expect(() =>
      defineFlow({
        kind: "demo",
        actions: {
          run: {
            block: noopHandler,
            inputSchema: z.object({ value: z.string().optional() })
          }
        },
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
