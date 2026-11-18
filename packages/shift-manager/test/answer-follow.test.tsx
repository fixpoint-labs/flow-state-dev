// @vitest-environment happy-dom
/**
 * An answer reads nothing of the Lab after it (FIX-2774). The Inbox, its
 * count and a task's asks read workforce's inbox view, which the server's
 * suspension notice re-runs once the answer is recorded: a whole-Lab read
 * after the answer, and another once the run it resumed stops, would be the
 * re-read loop this issue removes. The answer marks its session answered
 * once, for a conversation on screen to read itself back.
 *
 * The connection's client records each answer sent; the reader counts its reads.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { LabProvider, useLab, type LabData } from "../src/lib/lab-data";
import { useInboxAnswer } from "../src/lib/inbox";

let reads = 0;
const answers: unknown[] = [];

vi.mock("../src/lib/connection", () => ({
  connect: (connection: { userId: string }) => ({
    userId: connection.userId,
    subscribe: () => ({ close: () => {} }),
    flow: () => ({
      request: () => ({
        answer: async (body: unknown) => void answers.push(body),
        wait: async () => ({ status: "completed" }),
      }),
    }),
  }),
}));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => ({ watchRoster: () => () => {} }) }));
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return {
    ...real,
    createLabReader: () => ({
      read: async () => {
        reads += 1;
        return { refused: { message: "a Lab" } };
      },
      readBoard: async () => [],
    }),
  };
});

afterEach(cleanup);

let lab: LabData | undefined;
let answer: ReturnType<typeof useInboxAnswer> | undefined;
function Grab() {
  lab = useLab();
  answer = useInboxAnswer();
  return null;
}

/** An approval a worker's run in session `s1` waits on. */
const hold: InboxHold<unknown> = {
  id: "susp_1",
  source: { kind: "suspension", flowId: "desk", sessionId: "s1", requestId: "req_1", suspensionId: "susp_1" },
  ask: { kind: "approval", prompt: "Ship it?" },
  openedAt: 0,
  answerable: true,
  unanswerable: null,
};

describe("an answer given in Shift Manager", () => {
  it("goes through the answer route, reads nothing of the Lab after it, and marks its session answered once", async () => {
    render(
      <LabProvider connection={{ userId: "alice" }}>
        <Grab />
      </LabProvider>,
    );
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => {
      await answer!(hold, { approved: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(answers).toEqual([{ suspensionId: "susp_1", action: "approve" }]);
    expect(reads).toBe(1);
    expect(lab!.answered).toEqual({ sessionId: "s1", count: 1 });
  });
});
