// FIX-2522; FIX-2519 hands them on.
/**
 * A task's brief files reach every run of the task.
 * The manager reads them off the input the board packed from
 * the row, and puts them on the harness's run input beside the prompt, on
 * the first attempt and on the re-run after it failed, so a re-run sees the
 * screenshot the first run saw. A harness that declares no file types is
 * never handed a file: the attempt fails by name before the checkout is
 * taken, and the harness never runs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { CONVERSATIONS, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const shot: FileContent = { type: "file", mediaType: "image/png", filename: "bug.png", data: toBlobRef("b_briefshot0000000000000000000001") };

describe("a task's brief files", () => {
  it("go to the harness beside the prompt on every attempt", async () => {
    const lab = claimHost({ mode: "claim", accepts: ["image/png"], script: [{ throws: "first try fails" }, { answer: "it shows a red button" }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "say what the screenshot shows", attachments: [shot] });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("pending");
    const second = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(second.result.error, messageOf(second.result.error)).toBeUndefined();

    expect(lab.seen).toHaveLength(2);
    for (const run of lab.seen) expect(run.attachments).toEqual([shot]);
  }, 60_000);

  it("hands a task filed with none a text run, as before", async () => {
    const lab = claimHost({ mode: "claim", accepts: ["image/png"] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "just words" });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(lab.seen).toHaveLength(1);
    expect(lab.seen[0]!.attachments).toBeUndefined();
  }, 60_000);

  it("fails the attempt by name, and runs nothing, on a harness that takes no files", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look", attachments: [shot] });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    // The attempt's failure names the file and the harness; the row keeps its brief's files.
    const task = (await lab.row(CONVERSATIONS, "t1", "conv-a")) as { feedback?: string; attachments?: FileContent[] };
    expect(task.feedback).toContain(`This worker's harness can't take "bug.png" (image/png).`);
    expect(task.attachments).toEqual([shot]);
    expect(lab.seen).toHaveLength(0);
  }, 60_000);
});
