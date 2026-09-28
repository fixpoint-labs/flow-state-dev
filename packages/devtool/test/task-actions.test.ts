/**
 * Which of the viewed flow's actions a Tasks-tab row offers.
 *
 * The signal is the input, not the name: an action whose input requires a
 * string `taskId` acts on one task, so an app's own `answer` qualifies beside
 * the framework's task tools. A board's task tools carry the board in their
 * name, and are offered only on that board's rows.
 */
import { describe, expect, it } from "vitest";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { outcomeOf, taskActionsFor, taskToolSuffix } from "../src/react/lib/task-actions";

const takesTaskId: ActionInputSchema = {
  type: "object",
  fields: { taskId: { type: "string", required: true }, reason: { type: "string", required: false } },
};
const optionalTaskId: ActionInputSchema = {
  type: "object",
  fields: { taskId: { type: "string", required: false } },
};
const numericTaskId: ActionInputSchema = {
  type: "object",
  fields: { taskId: { type: "number", required: true } },
};
const noTaskId: ActionInputSchema = { type: "object", fields: { goal: { type: "string", required: true } } };

describe("taskActionsFor", () => {
  it("offers an action whose input requires a string taskId, and no other", () => {
    const schemas = { answer: takesTaskId, maybe: optionalTaskId, numeric: numericTaskId, file: noTaskId };
    expect(taskActionsFor(Object.keys(schemas), schemas, "issues", ["issues"])).toEqual(["answer"]);
  });

  it("offers a board's own tools only on that board, and a generic action on every board", () => {
    const schemas = {
      answer: takesTaskId,
      cancelTask_a_one: takesTaskId,
      cancelTask_b_two: takesTaskId,
    };
    const names = Object.keys(schemas);
    const boards = ["a.one", "b.two"];
    expect(taskActionsFor(names, schemas, "a.one", boards)).toEqual(["answer", "cancelTask_a_one"]);
    expect(taskActionsFor(names, schemas, "b.two", boards)).toEqual(["answer", "cancelTask_b_two"]);
  });

  it("scopes an app's own suffixed action the same way", () => {
    const schemas = { answer_a_one: takesTaskId, answer: takesTaskId };
    expect(taskActionsFor(Object.keys(schemas), schemas, "b.two", ["a.one", "b.two"])).toEqual(["answer"]);
  });

  it("keeps a task tool for a board the tab does not list off every other board", () => {
    // A board with no tasks yet is not listed, so its tools match no listed
    // suffix. They are still a board's tools, not generic actions.
    const schemas = { cancelTask_quiet_board: takesTaskId, answer: takesTaskId };
    expect(taskActionsFor(Object.keys(schemas), schemas, "issues", ["issues"])).toEqual(["answer"]);
  });

  it("matches a task tool to its board exactly, not by a shared ending", () => {
    // `cancelTask_feature_work` ends with `_work` too. Offered on the `work`
    // rows, it would send a `work` task's id to the other board's ledger.
    const schemas = { cancelTask_work: takesTaskId, cancelTask_feature_work: takesTaskId };
    const names = Object.keys(schemas);
    expect(taskActionsFor(names, schemas, "work", ["work", "feature.work"])).toEqual(["cancelTask_work"]);
    expect(taskActionsFor(names, schemas, "feature.work", ["work", "feature.work"])).toEqual([
      "cancelTask_feature_work",
    ]);
    // The same when the longer board has no tasks yet, so the tab does not list it.
    expect(taskActionsFor(names, schemas, "work", ["work"])).toEqual(["cancelTask_work"]);
  });

  it("gives an app's suffixed action to the board with the longest matching suffix", () => {
    const schemas = { answer_feature_work: takesTaskId, answer_work: takesTaskId };
    const names = Object.keys(schemas);
    const boards = ["work", "feature.work"];
    expect(taskActionsFor(names, schemas, "work", boards)).toEqual(["answer_work"]);
    expect(taskActionsFor(names, schemas, "feature.work", boards)).toEqual(["answer_feature_work"]);
  });

  it("offers nothing when the flow has no schemas", () => {
    expect(taskActionsFor(["answer"], undefined, "issues", ["issues"])).toEqual([]);
  });
});

describe("taskToolSuffix (mirrors orchestration's rule)", () => {
  it("turns every character outside [a-zA-Z0-9_-] into an underscore", () => {
    expect(taskToolSuffix("eng.feature.work")).toBe("eng_feature_work");
    expect(taskToolSuffix("support.help.escalations")).toBe("support_help_escalations");
    expect(taskToolSuffix("a-b_c")).toBe("a-b_c");
  });
});

describe("outcomeOf", () => {
  const root = (status: string, value?: unknown) => ({
    type: "block_trace",
    status,
    provenance: {},
    ...(value === undefined ? {} : { output: { kind: "inline", value } }),
  });
  const request = (rawItems: unknown[]) => [{ requestId: "r1", status: "completed", rawItems }];

  it("reads a guarded verb's refusal as a refusal", () => {
    expect(outcomeOf(request([root("completed", { ok: false, error: "task is terminal" })]), "r1")).toEqual({
      state: "refused",
      message: "task is terminal",
    });
  });

  it("reads a declined task write as a refusal, not a success", () => {
    // An app action such as `answer` returns the ledger's write outcome. A
    // declined one wrote nothing, so the row must not say it worked.
    const declined = { outcome: "declined", reason: "terminal", status: "completed" };
    expect(outcomeOf(request([root("completed", declined)]), "r1")).toEqual({
      state: "refused",
      message: "Declined (terminal): the task is completed.",
    });
    expect(outcomeOf(request([root("completed", { outcome: "recorded" })]), "r1")).toEqual({
      state: "ok",
      output: { outcome: "recorded" },
    });
  });

  it("reads the root trace's final state, not its in-progress entry", () => {
    // The raw log keeps the root's `in_progress` trace ahead of its completed one.
    const items = [root("in_progress"), root("completed", { ok: false, error: "no such task" })];
    expect(outcomeOf(request(items), "r1")).toEqual({ state: "refused", message: "no such task" });
    const failed = [root("in_progress"), { ...root("failed"), error: { message: "boom" } }];
    expect(outcomeOf(request(failed), "r1")).toEqual({ state: "failed", message: "boom" });
  });

  it("resolves a root output held by reference before reading it", () => {
    // A sequencer-backed action re-emits its last step's output as a `ref` to
    // that step's trace, or a `structure` of refs. The refusal lives behind
    // the reference, and must not read as success.
    const child = {
      id: "t-child",
      type: "block_trace",
      status: "completed",
      provenance: { parentBlockInstanceId: "root" },
      output: { kind: "inline", value: { ok: false, error: "task is terminal" } },
    };
    const refRoot = { type: "block_trace", status: "completed", provenance: {}, output: { kind: "ref", sourceItemId: "t-child" } };
    expect(outcomeOf(request([child, refRoot]), "r1")).toEqual({ state: "refused", message: "task is terminal" });

    const structureRoot = {
      type: "block_trace",
      status: "completed",
      provenance: {},
      output: {
        kind: "structure",
        shape: {
          container: "object",
          entries: { ok: { kind: "inline", value: false }, error: { kind: "ref", sourceItemId: "t-msg" } },
        },
      },
    };
    const message = { id: "t-msg", type: "message", content: [{ type: "output_text", text: "no such task" }] };
    expect(outcomeOf(request([message, structureRoot]), "r1")).toEqual({ state: "refused", message: "no such task" });
  });

  it("says the outcome isn't visible when a referenced output was not retained", () => {
    const refRoot = { type: "block_trace", status: "completed", provenance: {}, output: { kind: "ref", sourceItemId: "gone" } };
    expect(outcomeOf(request([refRoot]), "r1")).toEqual({ state: "unknown" });
  });
});
