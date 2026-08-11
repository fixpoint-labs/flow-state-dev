/**
 * The assembled workstream core checks the address it does not route on
 * (FIX-982).
 *
 * A flow with exactly one detached board skips the router — a `router_decision`
 * record for a choice with one option is a durable cost with no information in
 * it. What that shortcut must NOT skip is `boardId`, which is half the routing
 * address a detached envelope carries and is persisted with it.
 *
 * The failure it guards is quiet. A detached request is re-resolved from its
 * stored envelope, so an envelope written before a board was removed or renamed
 * arrives at whatever single board is registered now. If the two boards share a
 * durable ledger, every arm of the runner's start gate can pass — same row, same
 * attempt, same stamps, still `in_progress` — because none of them asks which
 * board the dispatch named. Stale work then executes as current work, settles a
 * live row, and nothing anywhere reports an error.
 *
 * The multi-board path gets this for free (`keyedRouter` refuses an unregistered
 * key), which is exactly why the single-board path has to be asserted
 * separately: the two are the same feature only if both refuse.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src";
import { buildWorkstreamCore } from "../src/flow/workstream-core";
import type { BlockDefinition } from "../src/types/block";
import type { WorkstreamBinding, WorkstreamBindings } from "../src/types/workstream";

function runnerBlock(name: string): BlockDefinition<never, never> {
  return handler({
    name,
    inputSchema: z.unknown(),
    execute: () => null,
  }) as unknown as BlockDefinition<never, never>;
}

/**
 * A binding set shaped the way the board factory stamps it: one runner object
 * per board, shared by every coordinate that board declares.
 */
function bindings(
  entries: ReadonlyArray<{ boardId: string; coordinateKey: string; runner: BlockDefinition<never, never> }>
): WorkstreamBindings {
  const map = new Map<string, WorkstreamBinding>();
  for (const entry of entries) {
    map.set(`${entry.boardId}::${entry.coordinateKey}`, {
      boardId: entry.boardId,
      coordinateKey: entry.coordinateKey,
      worker: runnerBlock(`${entry.boardId}-worker`),
      runner: entry.runner,
    } as WorkstreamBinding);
  }
  return map;
}

/** An envelope addressed to `boardId`, otherwise well-formed. */
function envelope(boardId: string): Record<string, unknown> {
  return {
    boardId,
    coordinateKey: "assignee:implement",
    taskId: "t1",
    attempt: 1,
    createdAt: 1_700_000_000_000,
    payload: { taskId: "t1" },
  };
}

describe("the single-board fast path still validates the board it was addressed to", () => {
  const soleRunner = runnerBlock("issue-work-runner");
  const core = buildWorkstreamCore(
    "issue-flow",
    bindings([
      { boardId: "issue-work", coordinateKey: "assignee:implement", runner: soleRunner },
      // A second coordinate on the SAME board, because that is the ordinary
      // shape: one runner, many detached workers. It must not turn this into
      // the multi-board path.
      { boardId: "issue-work", coordinateKey: "assignee:review", runner: soleRunner },
    ])
  );

  it("takes the fast path — the runner itself, not a router around it", () => {
    // If this ever becomes a router the refusal below stops being the thing
    // under test, and the assertion would pass for the wrong reason.
    expect(core?.block).toBe(soleRunner);
  });

  it("accepts an envelope addressed to the board it declares", () => {
    expect(core?.inputSchema?.safeParse(envelope("issue-work")).success).toBe(true);
  });

  it("refuses an envelope addressed to a board this flow no longer declares", () => {
    const parsed = core?.inputSchema?.safeParse(envelope("issue-work-legacy"));
    expect(parsed?.success).toBe(false);
    const issue = parsed?.success === false ? parsed.error.issues[0] : undefined;
    // Named, and naming BOTH boards: an operator reading this has to be able to
    // tell "the envelope is stale" from "the flow lost its board".
    expect(issue?.path).toEqual(["boardId"]);
    expect(issue?.message).toContain('addressed to board "issue-work-legacy"');
    expect(issue?.message).toContain('board "issue-work" only');
  });

  it("still validates the rest of the envelope", () => {
    // The refusal is added to the dispatch schema, not substituted for it.
    const { boardId, ...withoutTaskId } = { ...envelope("issue-work"), taskId: "" };
    expect(
      core?.inputSchema?.safeParse({ boardId, ...withoutTaskId }).success
    ).toBe(false);
  });
});

describe("the multi-board path refuses an unregistered board at the router", () => {
  it("keeps routing on boardId once there is more than one", () => {
    const core = buildWorkstreamCore(
      "issue-flow",
      bindings([
        { boardId: "issue-work", coordinateKey: "assignee:implement", runner: runnerBlock("a") },
        { boardId: "release-work", coordinateKey: "assignee:cut", runner: runnerBlock("b") },
      ])
    );

    // Both addresses parse — the router, not the schema, is what refuses an
    // unknown board here, and it does so with the key it could not resolve.
    expect(core?.inputSchema?.safeParse(envelope("issue-work")).success).toBe(true);
    expect(core?.inputSchema?.safeParse(envelope("gone")).success).toBe(true);
    expect(core?.block.kind).toBe("router");
  });
});
