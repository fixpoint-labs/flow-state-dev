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
import { outcomeOf, taskActionsFor, taskToolSuffix, type RequestOutcomeSource } from "../src/react/lib/task-actions";

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
    // board. A board this session has no rows on (a sibling Workforce mailbox
    // sharing the flow kind, or a board with no tasks yet) is not listed, but
    // its family in the flow's action list still names it, so its tools are
    // that board's and never generic.
    const family = (suffix: string) =>
      ["addTask", "assignTask", "completeTask", "failTask", "blockTask", "cancelTask", "updateTask", "listTasks"].map(
        (tool) => `${tool}_${suffix}`
      );
    const schemasFor = (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, name.startsWith("addTask") || name.startsWith("listTasks") ? noTaskId : takesTaskId]));

    it("keeps a sibling mailbox's tools off this mailbox's rows", () => {
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
  // The row reads what the engine recorded for its request: the status and
  // the stored action result from the session's request list. Nothing else.
  const listed = (status: string, result?: RequestOutcomeSource["result"]) => [
    { requestId: "r1", status, ...(result === undefined ? {} : { result }) },
  ];
  const refusal = { ok: false, error: "task is cancelled, which is terminal" };

  it("is pending until the request is listed, and while it runs or is suspended (BR-13)", () => {
    expect(outcomeOf([], "r1")).toEqual({ state: "pending" });
    expect(outcomeOf(listed("in_progress"), "r1")).toEqual({ state: "pending" });
    expect(outcomeOf(listed("suspended"), "r1")).toEqual({ state: "pending" });
    // Another request's record says nothing about this one.
    expect(outcomeOf([{ requestId: "r2", status: "completed", result: { output: refusal } }], "r1")).toEqual({
      state: "pending",
    });
  });

  it("reads a guarded verb's refusal as a refusal, in its own words (BR-14)", () => {
    expect(outcomeOf(listed("completed", { output: refusal }), "r1")).toEqual({
      state: "refused",
      message: "task is cancelled, which is terminal",
    });
  });

  it("reads ok:false as a refusal whatever the error looks like (BR-14)", () => {
    expect(outcomeOf(listed("completed", { output: { ok: false } }), "r1")).toEqual({
      state: "refused",
      message: "The action refused, without a reason.",
    });
    expect(outcomeOf(listed("completed", { output: { ok: false, error: { message: "locked" } } }), "r1")).toEqual({
      state: "refused",
      message: "locked",
    });
    expect(outcomeOf(listed("completed", { output: { ok: false, error: { code: 7 } } }), "r1")).toEqual({
      state: "refused",
      message: '{"code":7}',
    });
  });

  it("reads a declined task write as a refusal, not a success (BR-14)", () => {
    // An app action such as `answer` returns the ledger's write outcome. A
    // declined one wrote nothing, so the row must not say it worked.
    const declined = { outcome: "declined", reason: "terminal", status: "completed" };
    expect(outcomeOf(listed("completed", { output: declined }), "r1")).toEqual({
      state: "refused",
      message: "Declined (terminal): the task is completed.",
    });
    expect(outcomeOf(listed("completed", { output: { outcome: "declined" } }), "r1")).toEqual({
      state: "refused",
      message: "Declined: the write did not land.",
    });
  });

  it("reads any other output as done, showing it (BR-15)", () => {
    expect(outcomeOf(listed("completed", { output: { outcome: "recorded" } }), "r1")).toEqual({
      state: "ok",
      output: { outcome: "recorded" },
    });
    // An action that returned nothing is done, with nothing to show.
    expect(outcomeOf(listed("completed", {}), "r1")).toEqual({ state: "ok", output: undefined });
  });

  it("decides a request that ended in anything but completed by its status first (BR-16)", () => {
    const hookError = { code: "execution_error", message: "notification hook failed" };
    expect(outcomeOf(listed("failed", { error: hookError }), "r1")).toEqual({
      state: "failed",
      message: "notification hook failed",
    });
    // A hook failed the request after the action refused: failed, with the refusal named.
    expect(outcomeOf(listed("failed", { error: hookError, output: refusal }), "r1")).toEqual({
      state: "failed",
      message: "notification hook failed (the action itself refused: task is cancelled, which is terminal)",
    });
    // A hook failed it after the action answered ok: failed, never done.
    expect(outcomeOf(listed("failed", { error: hookError, output: { ok: true } }), "r1")).toEqual({
      state: "failed",
      message: "notification hook failed",
    });
    expect(outcomeOf(listed("incomplete", { output: { partial: true } }), "r1")).toEqual({
      state: "failed",
      message: "The request ended incomplete.",
    });
    // No result on a failed request: the status, and that nothing was recorded.
    expect(outcomeOf(listed("failed"), "r1")).toEqual({
      state: "failed",
      message: "The request ended failed. No result recorded for this request.",
    });
    // Aborted and interrupted carry no result by design; that is not "not recorded".
    expect(outcomeOf(listed("aborted"), "r1")).toEqual({ state: "failed", message: "The request ended aborted." });
    expect(outcomeOf(listed("interrupted"), "r1")).toEqual({
      state: "failed",
      message: "The request ended interrupted.",
    });
  });

  it("never guesses a finished request with no recorded result: not done, not refused (BR-17)", () => {
    expect(outcomeOf(listed("completed"), "r1")).toEqual({ state: "unknown", reason: "not-reported" });
    // A store that hands an absent field back as null reads the same (BP-030).
    expect(outcomeOf([{ requestId: "r1", status: "completed", result: null }], "r1")).toEqual({
      state: "unknown",
      reason: "not-reported",
    });
  });

  it("says a return value that could not be recorded is unknown (BR-17a)", () => {
    expect(outcomeOf(listed("completed", { outputNotRecorded: true }), "r1")).toEqual({
      state: "unknown",
      reason: "output-not-recorded",
    });
  });
});
