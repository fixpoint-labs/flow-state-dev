/**
 * A code change filed with no assignee, on the lab's own host with only the
 * model scripted. The main session has several delegates, and its board's
 * dispatch claims only a task that names one, so a task filed with none would
 * sit pending with nobody to run it while the reply says it is under way.
 * `createTask` refuses it instead, and the refusal names who can take it, so
 * the turn can file it again for the coder.
 */
import { afterEach, describe, expect, it } from "vitest";
import { codingBoardViewRef } from "@flow-state-dev/harness-manager/browser";
import { closeApps, openTestApp, waitFor, type TestApp } from "./app-host";

const ASK = "Rename the greeting in src/hello.ts.";

afterEach(closeApps);

/** The session's tasks on the coding board, read once the turn has taken its createTask result. */
async function tasksAfterTurn(lab: TestApp, session: string, results: string[]) {
  const end = Date.now() + 20_000;
  while (results.length === 0) {
    if (Date.now() > end) throw new Error("the main turn never took its createTask result");
    await waitFor(100);
  }
  const read = async () => (await lab.client.view(codingBoardViewRef(), { sessionId: session })).value;
  const tasks = await read();
  if (tasks.length === 0) return tasks;
  // A task was filed: long enough for its dispatch to have claimed it, had anything claimed it.
  await waitFor(1_500);
  return read();
}

describe("desk.main files a code change with no assignee", () => {
  it("is refused with the delegates it can name, and nothing waits on the board unowned", async () => {
    // The tool results `desk.main` was handed, one per step after its first.
    const results: string[] = [];
    const lab = await openTestApp({
      scripts: {
        "agent-answer": ({ said, step }) => {
          if (!/You are main/.test(said)) return { text: "done" };
          if (step === 0) return { call: { name: "createTask", args: { title: "Rename the greeting", goal: ASK } } };
          results.push(said.slice(said.lastIndexOf("createTask")));
          return { text: "Filed." };
        },
      },
    });
    const session = (await lab.calls.openSession("session", lab.project!.id)).id;
    await lab.calls.send(session, ASK);
    const tasks = await tasksAfterTurn(lab, session, results);
    // Without the refusal the task is filed and sits pending, unassigned, forever.
    expect(tasks.filter((task) => task.assignee === undefined)).toEqual([]);
    expect(results[0]).toContain("assignee_required");
    expect(results[0]).toContain("desk.coder");
  }, 60_000);
});
