// @vitest-environment happy-dom
/**
 * An answer given on one connection is followed on that connection only
 * (FIX-2455). The answer reads the Lab again and then follows the run it
 * resumed; when the page switches to another Lab meanwhile, nothing the old
 * answer does afterwards reads the old Lab, so the new Lab's snapshot is never
 * drawn over with the old one's.
 *
 * Each connection gets its own client and reader; the test counts the reads
 * each reader makes.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabProvider, useLab, type LabData } from "../src/lib/lab-data";
import type { Ask } from "../src/lib/reads";

/** Reads per connection's user, and the one `resume` the test holds open. */
const reads = new Map<string, number>();
let releaseResume: (() => void) | undefined;

vi.mock("../src/lib/connection", () => ({
  connect: (connection: { userId: string }) => ({
    userId: connection.userId,
    subscribe: () => ({ close: () => {} }),
    // The resumed run has settled by the time it is followed.
    flow: () => ({ request: () => ({ wait: async () => ({ status: "completed" }) }) }),
  }),
}));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => ({ watchRoster: () => () => {} }) }));
vi.mock("../src/lib/reads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/reads")>();
  return {
    ...real,
    createLabReader: (client: { userId: string }) => ({
      read: async () => {
        reads.set(client.userId, (reads.get(client.userId) ?? 0) + 1);
        return { refused: { message: `the ${client.userId} Lab` } };
      },
      readBoard: async () => [],
      resume: () => new Promise<void>((resolve) => (releaseResume = resolve)),
    }),
  };
});

afterEach(cleanup);

let lab: LabData | undefined;
function Grab() {
  lab = useLab();
  return null;
}

describe("an answer given on one connection", () => {
  it("reads nothing from the old Lab once the page has switched to another", async () => {
    const A = { userId: "on_a" };
    const B = { userId: "on_b" };
    const { rerender } = render(
      <LabProvider connection={A}>
        <Grab />
      </LabProvider>,
    );
    await waitFor(() => expect(reads.get("on_a")).toBe(1));

    const ask = { sessionId: "s1", flowId: "desk", item: { requestId: "req_1" } } as unknown as Ask;
    let answering!: Promise<void>;
    act(() => {
      answering = lab!.answer(ask, { action: "approve" });
    });
    await waitFor(() => expect(releaseResume).toBeDefined());

    // The page moves to another Lab while the answer is still on its way.
    rerender(
      <LabProvider connection={B}>
        <Grab />
      </LabProvider>,
    );
    await waitFor(() => expect(reads.get("on_b")).toBe(1));
    const aReadsAtSwitch = reads.get("on_a");

    await act(async () => {
      releaseResume!();
      await answering;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(reads.get("on_a")).toBe(aReadsAtSwitch);
  });
});
