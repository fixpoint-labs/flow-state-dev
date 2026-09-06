/**
 * Proof for Workforce POC lab C: one session holds plan prose as resource
 * content and tasks as the board's structured half. Separate actions, same
 * stores — if either half needed a doc store or a second planner, this fails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import workforcePocCFlow from "../src/flow";

const USER = "poc-owner";
const SESSION = "plan-demo";

type Stores = ReturnType<typeof createInMemoryStores>;

function run(
  stores: Stores,
  action: "writePlan" | "addTask" | "readPlan",
  input: Record<string, unknown>
) {
  return testFlow({
    flow: workforcePocCFlow,
    action,
    userId: USER,
    sessionId: SESSION,
    stores,
    input,
  });
}

let stores: Stores;
beforeEach(() => {
  stores = createInMemoryStores();
});

describe("plan = board + content", () => {
  it("reads null content and no tasks before anything is written", async () => {
    const result = await run(stores, "readPlan", {});
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ body: null, tasks: [] });
  });

  it("writes plan text, attaches tasks on the same plan, and reads both back", async () => {
    const specBody = [
      "# Ship the intake form",
      "",
      "The form is the product this week. Validate email. Do not add a CRM.",
    ].join("\n");

    const written = await run(stores, "writePlan", { body: specBody });
    expect(written.status).toBe("completed");
    expect(written.output).toEqual({ written: true });

    const first = await run(stores, "addTask", {
      id: "validate-email",
      goal: "Reject blank and malformed emails on submit",
      title: "Validate email",
      context: "See the spec: the form is the product this week.",
    });
    expect(first.status).toBe("completed");
    expect(first.output).toMatchObject({
      id: "validate-email",
      goal: "Reject blank and malformed emails on submit",
      title: "Validate email",
      status: "pending",
    });

    const second = await run(stores, "addTask", {
      id: "no-crm",
      goal: "Do not add a CRM integration",
    });
    expect(second.status).toBe("completed");
    expect(second.output).toMatchObject({ id: "no-crm", status: "pending" });

    const read = await run(stores, "readPlan", {});
    expect(read.status).toBe("completed");
    const output = read.output as {
      body: string | null;
      tasks: Array<Record<string, unknown>>;
    };
    // Content is the spec. Rows are the board. list() order is store-defined
    // (in-memory insertion vs filesystem key order) — not a plan document.
    expect(output.body).toBe(specBody);
    expect(output.tasks).toEqual(
      expect.arrayContaining([
        {
          id: "validate-email",
          goal: "Reject blank and malformed emails on submit",
          title: "Validate email",
          context: "See the spec: the form is the product this week.",
          status: "pending",
        },
        {
          id: "no-crm",
          goal: "Do not add a CRM integration",
          status: "pending",
        },
      ])
    );
    expect(output.tasks).toHaveLength(2);
  });

  it("keeps a second session as a different plan", async () => {
    await run(stores, "writePlan", { body: "Plan A spec" });
    await run(stores, "addTask", { id: "a1", goal: "A work" });

    const other = await testFlow({
      flow: workforcePocCFlow,
      action: "readPlan",
      userId: USER,
      sessionId: "plan-other",
      stores,
      input: {},
    });
    expect(other.status).toBe("completed");
    expect(other.output).toEqual({ body: null, tasks: [] });
  });
});
