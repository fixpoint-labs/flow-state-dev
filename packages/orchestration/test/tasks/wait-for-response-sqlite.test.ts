/**
 * Ask across a SQLite cold restart (FIX-1816 P2, V3 and V4).
 *
 * The turn asks and parks; the asked row ends; the runtime is thrown away
 * after the ending's write and before anything resumed the turn. A second
 * runtime opens a fresh store registry on the same file, and the next touch
 * of the board resumes the turn once. The resumed turn replays to the waiting
 * call, which reads its first filing back: one row.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  act,
  askCall,
  askFlow,
  finalAnswer,
  rows,
  runtimeFor,
  statusOf,
  stepModel,
  toolResults,
  until
} from "./ask-fixture";

let dir: string | undefined;
const live: Array<ReturnType<typeof runtimeFor>> = [];

afterEach(async () => {
  for (const state of live.splice(0)) await state.dispose();
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("ask across a SQLite cold restart", () => {
  it("an ending written before the restart is resumed by the next touch after it, once, and files one row", async () => {
    dir = await mkdtemp(join(tmpdir(), "fsd-ask-board-"));
    const filename = join(dir, "store.db");
    // One script across both runtimes: the step before the park, and the one after.
    const seen: GeneratorModelCallOptions[] = [];

    const flowBefore = askFlow(stepModel([askCall("c1"), finalAnswer], seen).model);
    const before = runtimeFor(flowBefore, sqliteStores({ filename }));
    live.push(before);
    const parked = await act(before, flowBefore, "run");
    expect(await statusOf(before, parked.requestId!)).toBe("suspended");
    await act(before, flowBefore, "settle", { outcome: { kind: "complete", output: "Yes, renewed 2026-08" } });
    expect((await rows(before, flowBefore))[0]).toMatchObject({ status: "completed", resumeOwed: true });
    // The process is gone after the ending's write, before any resume.
    await before.dispose();
    live.splice(live.indexOf(before), 1);

    const flowAfter = askFlow(stepModel([askCall("c1"), finalAnswer], seen).model);
    const after = runtimeFor(flowAfter, sqliteStores({ filename }));
    live.push(after);
    const touched = await act(after, flowAfter, "touch");
    expect(touched.output).toMatchObject({ resumed: [expect.any(String)], stillOwed: [] });
    await until(after, parked.requestId!, "completed");

    expect(seen).toHaveLength(2);
    expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
    const board = await rows(after, flowAfter);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: "completed", resumeOwed: false });
    // Replayed again, nothing more is owed.
    expect((await act(after, flowAfter, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
  });
});
