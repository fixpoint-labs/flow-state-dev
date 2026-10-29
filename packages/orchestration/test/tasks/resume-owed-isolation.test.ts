/**
 * `payOwedResumes` keeps one row's failure to that row (FIX-1816 P3): a resume
 * or a marker clear that throws leaves that row owed for the next touch, and
 * the touch still reaches every other row and returns, so a board run's notice
 * replay behind it still runs.
 */
import { describe, expect, it } from "vitest";
import type { TaskCollectionRef } from "../../src/tasks";
import { payOwedResumes } from "../../src/tasks/helpers/wait-on-task";

const row = (id: string) => ({ id, status: "completed", output: id, wait: { gateId: `wait:b:${id}`, deadline: 1 }, resumeOwed: true });

function board(clearFails: ReadonlySet<string>) {
  const cleared: string[] = [];
  const collection = {
    list: () => [row("a"), row("b")],
    clearResumeOwed: async (id: string) => {
      if (clearFails.has(id)) throw new Error("the store blinked");
      cleared.push(id);
    }
  } as unknown as TaskCollectionRef;
  return { collection, cleared };
}

describe("payOwedResumes: one row's failure is that row's", () => {
  it("a resume that throws leaves its row owed and resumes the next", async () => {
    const { collection, cleared } = board(new Set());
    const ctx = {
      requestHost: {
        resumeWait: async ({ gateId }: { gateId: string }) => {
          if (gateId === "wait:b:a") throw new Error("the store blinked");
          return { ok: true };
        }
      }
    };
    await expect(payOwedResumes(ctx as never, collection)).resolves.toEqual({ resumed: ["b"], stillOwed: ["a"] });
    expect(cleared).toEqual(["b"]);
  });

  it("a resume refused busy (the turn still parking) leaves its row owed, and only already-resolved clears it (FIX-2135)", async () => {
    const { collection, cleared } = board(new Set());
    const ctx = {
      requestHost: {
        resumeWait: async ({ gateId }: { gateId: string }) =>
          gateId === "wait:b:a"
            ? { ok: false, refused: "busy", detail: "not parked yet" }
            : { ok: false, refused: "already-resolved", detail: "resolved" }
      }
    };
    await expect(payOwedResumes(ctx as never, collection)).resolves.toEqual({ resumed: [], stillOwed: ["a"] });
    expect(cleared).toEqual(["b"]);
  });

  it("a marker clear that throws after an accepted resume leaves the row owed, and the touch goes on", async () => {
    const { collection, cleared } = board(new Set(["a"]));
    const ctx = { requestHost: { resumeWait: async () => ({ ok: true }) } };
    await expect(payOwedResumes(ctx as never, collection)).resolves.toEqual({ resumed: ["b"], stillOwed: ["a"] });
    expect(cleared).toEqual(["b"]);
  });
});
