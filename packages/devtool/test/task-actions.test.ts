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

  it("BR-10 · offers an action matching no listed board's suffix on every board, task-tool name or not", () => {
    // `cancelTask_now` is an app's own action that happens to share a task
    // tool's verb. Its ending names no board the tab lists, so it is generic.
    const schemas = { cancelTask_now: takesTaskId, answer: takesTaskId };
    const names = Object.keys(schemas);
    expect(taskActionsFor(names, schemas, "issues", ["issues", "bugs"])).toEqual(["cancelTask_now", "answer"]);
    expect(taskActionsFor(names, schemas, "bugs", ["issues", "bugs"])).toEqual(["cancelTask_now", "answer"]);
  });

  it("BR-10 · gives a task tool to the listed board with the longest matching suffix", () => {
    // `cancelTask_feature_work` ends with `_work` too. With both boards
    // listed it belongs to `feature.work` alone, not to `work`.
    const schemas = { cancelTask_work: takesTaskId, cancelTask_feature_work: takesTaskId };
    const names = Object.keys(schemas);
    expect(taskActionsFor(names, schemas, "work", ["work", "feature.work"])).toEqual(["cancelTask_work"]);
    expect(taskActionsFor(names, schemas, "feature.work", ["work", "feature.work"])).toEqual([
      "cancelTask_feature_work",
    ]);
  });

  it("gives an app's suffixed action to the board with the longest matching suffix", () => {
    const schemas = { answer_feature_work: takesTaskId, answer_work: takesTaskId };
    const names = Object.keys(schemas);
    const boards = ["work", "feature.work"];
    expect(taskActionsFor(names, schemas, "work", boards)).toEqual(["answer_work"]);
    expect(taskActionsFor(names, schemas, "feature.work", boards)).toEqual(["answer_feature_work"]);
  });

  describe("a board named only by its generated task tools", () => {
    // `taskToolActions` always generates the whole family of eight for a
    // board. A board this session has no rows on (a sibling Workforce channel
    // sharing the flow kind, or a board with no tasks yet) is not listed, but
    // its family in the flow's action list still names it, so its tools are
    // that board's and never generic.
    const family = (suffix: string) =>
      ["addTask", "assignTask", "completeTask", "failTask", "blockTask", "cancelTask", "updateTask", "listTasks"].map(
        (tool) => `${tool}_${suffix}`
      );
    const schemasFor = (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, name.startsWith("addTask") || name.startsWith("listTasks") ? noTaskId : takesTaskId]));

    it("keeps a sibling channel's tools off this channel's rows", () => {
      const names = [...family("eng_queue_work"), ...family("eng_other_work")];
      const offered = taskActionsFor(names, schemasFor(names), "eng.queue.work", ["eng.queue.work"]);
      expect(offered).toEqual([
        "assignTask_eng_queue_work",
        "completeTask_eng_queue_work",
        "failTask_eng_queue_work",
        "blockTask_eng_queue_work",
        "cancelTask_eng_queue_work",
        "updateTask_eng_queue_work",
      ]);
    });

    it("keeps an unlisted board's tools off a listed board that shares its ending", () => {
      const names = [...family("work"), ...family("feature_work")];
      const offered = taskActionsFor(names, schemasFor(names), "work", ["work"]);
      expect(offered.every((name) => name.endsWith("_work") && !name.endsWith("_feature_work"))).toBe(true);
      expect(offered).toHaveLength(6);
    });

    it("still offers an app's own action on every board when no family names its ending", () => {
      const names = [...family("issues"), "cancelTask_now"];
      const schemas = schemasFor(names);
      expect(taskActionsFor(names, schemas, "bugs", ["issues", "bugs"])).toEqual(["cancelTask_now"]);
    });
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

  describe("with request lifecycle hooks", () => {
    // `runAction` runs the flow's and the action's lifecycle hooks (onStarted,
    // onCompleted, onErrored, onFinished) as root blocks of the same request,
    // before and after the action itself, and every one of them receives
    // `{ requestId, actionName }`. The action's own trace has to be picked out
    // of them: a hook's result is not the action's answer.
    let seq = 0;
    const trace = (status: string, input: unknown, output?: unknown, error?: string, id = `t${seq++}`) => ({
      id,
      type: "block_trace",
      status,
      provenance: {},
      input: { source: { kind: "inline", value: input } },
      ...(output === undefined ? {} : { output: { kind: "inline", value: output } }),
      ...(error === undefined ? {} : { error: { message: error } }),
    });
    const hookInput = { requestId: "r1", actionName: "cancelTask_issues" };
    const actionInput = { taskId: "task-a" };
    const withStatus = (status: string, rawItems: unknown[]) => [{ requestId: "r1", status, rawItems }];

    it("reads a refusal from the action, not from an onCompleted hook that ran after it", () => {
      const items = [
        trace("completed", hookInput), // onStarted
        trace("completed", actionInput, { ok: false, error: "task is terminal" }),
        trace("completed", { ...hookInput, output: { ok: false } }), // onCompleted
        trace("completed", { ...hookInput, status: "completed" }), // onFinished
      ];
      expect(outcomeOf(request(items), "r1")).toEqual({ state: "refused", message: "task is terminal" });
    });

    it("reads a failed action as failed, not from the onErrored hook that ran after it", () => {
      const items = [
        trace("failed", actionInput, undefined, "no such task"),
        trace("completed", hookInput, "logged"), // onErrored
        trace("completed", hookInput), // onFinished
      ];
      expect(outcomeOf(withStatus("failed", items), "r1")).toEqual({ state: "failed", message: "no such task" });
    });

    it("tells a hook apart by its final entry, when its first entry carries no input yet", () => {
      const hookStart = { id: "hook", type: "block_trace", status: "in_progress", provenance: {} };
      const items = [
        trace("completed", actionInput, { ok: false, error: "task is terminal" }),
        hookStart,
        { ...trace("completed", hookInput), id: "hook" },
      ];
      expect(outcomeOf(request(items), "r1")).toEqual({ state: "refused", message: "task is terminal" });
    });

    it("reads a request that failed in a hook after the action answered ok as failed, never as success", () => {
      const items = [
        trace("completed", actionInput, { ok: true }),
        trace("failed", hookInput, undefined, "onCompleted threw"),
      ];
      expect(outcomeOf(withStatus("failed", items), "r1")).toEqual({ state: "failed", message: "onCompleted threw" });
    });
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

  it("says the outcome isn't visible when a reference nested inside a structure was not retained", () => {
    // `{ ok: false, error: <evicted ref> }` resolves to `{ ok: false, error:
    // undefined }`. Read as it stands, that is not a refusal and would say
    // "Done". Any unresolved reference, at any depth, means the result can't
    // be told.
    const structureRoot = (entries: Record<string, unknown>) => ({
      type: "block_trace",
      status: "completed",
      provenance: {},
      output: { kind: "structure", shape: { container: "object", entries } },
    });
    const nested = structureRoot({ ok: { kind: "inline", value: false }, error: { kind: "ref", sourceItemId: "gone" } });
    expect(outcomeOf(request([nested]), "r1")).toEqual({ state: "unknown", reason: "not-retained" });
    const inArray = {
      type: "block_trace",
      status: "completed",
      provenance: {},
      output: { kind: "structure", shape: { container: "array", entries: [{ kind: "ref", sourceItemId: "gone" }] } },
    };
    expect(outcomeOf(request([inArray]), "r1")).toEqual({ state: "unknown", reason: "not-retained" });
    // A ref to a trace that finished without an output, one hop down.
    const emptyChild = { id: "t-empty", type: "block_trace", status: "completed", provenance: { parentBlockInstanceId: "root" } };
    const viaChild = structureRoot({ result: { kind: "ref", sourceItemId: "t-empty" } });
    expect(outcomeOf(request([emptyChild, viaChild]), "r1")).toEqual({ state: "unknown", reason: "not-retained" });
  });

  it("reads ok:false as a refusal whatever the error looks like", () => {
    expect(outcomeOf(request([root("completed", { ok: false })]), "r1")).toEqual({
      state: "refused",
      message: "The action refused, without a reason.",
    });
    expect(outcomeOf(request([root("completed", { ok: false, error: { message: "locked" } })]), "r1")).toEqual({
      state: "refused",
      message: "locked",
    });
    expect(outcomeOf(request([root("completed", { ok: false, error: { code: 7 } })]), "r1")).toEqual({
      state: "refused",
      message: '{"code":7}',
    });
  });

  it("reads a declined write as a refusal even without a reason or status", () => {
    expect(outcomeOf(request([root("completed", { outcome: "declined" })]), "r1")).toEqual({
      state: "refused",
      message: "Declined: the write did not land.",
    });
  });

  it("says the outcome isn't visible when a referenced output was not retained", () => {
    const refRoot = { type: "block_trace", status: "completed", provenance: {}, output: { kind: "ref", sourceItemId: "gone" } };
    expect(outcomeOf(request([refRoot]), "r1")).toEqual({ state: "unknown", reason: "not-retained" });
  });
});
