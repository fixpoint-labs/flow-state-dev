/**
 * `itemScope`: the task scope a harness item carries, read off the runtime
 * identity. Harness emitters spread what it returns straight onto every item,
 * so the rule under test is presence: a key appears exactly when the identity
 * defines it, an empty string counts as defined, and nothing else leaks in. A
 * key set to `undefined` would persist on every item as a key that means
 * nothing; a truthiness test would drop an empty-string task the runtime handed
 * over.
 */
import { describe, expect, it } from "vitest";
import { itemScope } from "../src/types";

const BASE = { blockName: "b", blockInstanceId: "b_1" };

describe("itemScope", () => {
  it.each([
    ["no identity", undefined, {}],
    ["an identity with neither field", BASE, {}],
    ["task only", { ...BASE, taskId: "task_42" }, { taskId: "task_42" }],
    ["owner only", { ...BASE, ownedBy: "container_7" }, { ownedBy: "container_7" }],
    ["task and owner", { ...BASE, taskId: "task_42", ownedBy: "container_7" }, { taskId: "task_42", ownedBy: "container_7" }],
    ["an empty-string task", { ...BASE, taskId: "" }, { taskId: "" }],
    ["fields explicitly undefined", { ...BASE, taskId: undefined, ownedBy: undefined }, {}],
  ])("returns exactly the present fields for %s", (_label, identity, expected) => {
    const scope = itemScope({ _blockIdentity: identity });
    expect(scope).toEqual(expected);
    expect(Object.keys(scope).sort()).toEqual(Object.keys(expected).sort());
  });

  it("returns only task and owner, never the rest of the identity", () => {
    const scope = itemScope({
      _blockIdentity: { ...BASE, taskId: "t", ownedBy: "o", phase: "main", blockPath: "root", attempt: 0 },
    });
    expect(Object.keys(scope).sort()).toEqual(["ownedBy", "taskId"]);
  });
});
