/**
 * Goal check — a team declared entirely in files has work filed onto its
 * channel's board by one seat and run to completion by another, which claimed
 * it rather than being handed it.
 *
 * **Model-free on purpose.** Nothing here is a judgment call: a row is filed,
 * a board drains it, a side effect happens or it does not. Putting a model in
 * the loop would add a way to fail that has nothing to do with the claim.
 *
 * What the tree contributes, and the code does not: the channel's id, the
 * board's local name, the members, and which seat runs which kind. The ledger
 * id is never written anywhere — it is minted from where the channel folder
 * sits, which is why leg 0 greps the whole tree for it and fails if it is
 * there.
 *
 * Legs:
 *   0  the tree declares a local name and never an id
 *   a  the tree alone produces the roster, the instances and the seats
 *   b  the channel's own read lists the board it holds, by name
 *   c  one seat files one row through the channel — no board in its own code
 *   d  the other seat's board CLAIMS it and runs it, and the work really ran
 *   e  the row is completed on the minted ledger, read straight out of storage
 *
 * Run: pnpm tsx goals/channel-boards/it-runs-a-row-a-file-declared-board-holds/run.mts
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  hireWorkforce,
  openChannels,
  workerConfigSchema,
  type ChannelManifest,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { goalTmpDir, runGoal } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_channel_boards";
const ORG_ID = "org_channel_boards";

/** Where the drained worker leaves its proof. A real file, not a counter. */
const OUTBOX = join(goalTmpDir("channel-boards"), "ran.txt");

/**
 * Controls perturb THIS FILE, never the fixture tree — leg 0 reads the tree, so
 * a fixture edit would die there and prove only that leg 0 works.
 *
 *   by-name  the coder seat resolves the board under a DIFFERENT channel that
 *            declares the same local name. Everything still compiles and every
 *            id is well-formed; only the mint differs. Must fail at leg (d)/(e),
 *            which is what makes those legs a test of the minted identity rather
 *            than of the local name.
 */
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** Every file in the tree, so leg 0 can look for a minted id in all of them. */
function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

await runGoal(async () => {
  const failures: string[] = [];
  mkdirSync(join(OUTBOX, ".."), { recursive: true });
  writeFileSync(OUTBOX, "", "utf8");

  // ---- a. the tree alone produces the roster --------------------------------
  const roster = await readWorkforce(TREE);
  const read = await readChannelsDirectory(TREE);
  if (roster.errors.length > 0 || read.errors.length > 0) {
    return { failures: ["the tree did not load cleanly"], evidence: "" };
  }

  const workers: WorkerManifest[] = roster.workers;
  const channels: ChannelManifest[] = read.channels;
  const channel = channels[0];
  if (channel === undefined) return { failures: ["the tree declared no channel"], evidence: "" };

  // Read off the FILE, never hardcoded — swap the folder names and a correct
  // implementation still passes.
  const boardName = (channel.declared.boards as string[])[0]!;
  const boardId = channelBoardIds(channels)[0]!;
  const triage = channelBoard(channel.id, boardName);

  // ---- 0. the tree names a board and never an id ----------------------------
  for (const path of treeFiles(TREE)) {
    if (readFileSync(path, "utf8").includes(boardId)) {
      failures.push(`${path} writes the minted ledger id "${boardId}"; a file declares a name`);
    }
  }

  // ---- the two kinds. Neither writes a ledger id. ---------------------------
  const emKind = defineFlow({
    kind: "em",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      file: {
        // The EM has no board, no collection and no drain — the one line that
        // reaches the work is a dispatch into the channel's own session.
        block: dispatcher({
          name: "em-file-row",
          flowKind: CHANNEL_KIND,
          action: "fileTask",
          inputSchema: z.object({ goal: z.string() }),
          session: { id: () => channel.id },
          payload: (input: { goal: string }) => ({
            board: boardName,
            goal: input.goal,
            assignee: "coder",
            author: "eng.em"
          })
        })
      }
    }
  } as never);

  const ran = handler({
    name: "coder-run-row",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ did: z.string() }),
    execute: async (input: TaskWorkerInput) => {
      // A real side effect: proving "it ran" by a file rather than by the
      // board's own report, which the board would produce either way.
      writeFileSync(OUTBOX, `${input.goal}\n`, { flag: "a" });
      return { did: input.goal };
    }
  });

  // What the SEAT reaches for. On the passing path it is the same mint the
  // channel made; under `by-name` it is another channel's board of the same
  // name, so "the names match" stops being enough.
  const seatBoard = CONTROL === "by-name" ? channelBoard("other.team", boardName) : triage;

  const board = taskBoard({
    name: "channel-triage",
    boardId: "channel-triage",
    collection: seatBoard,
    concurrency: 1,
    workers: { coder: ran }
  });

  const coderKind = defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    // The whole of what a seat declares to reach the channel's ledger.
    resources: { [seatBoard.id]: seatBoard },
    actions: { drain: { block: board.drain } }
  } as never);

  const instances = channelInstances(channels);
  const seats = hireWorkforce(workers, {
    kinds: { em: emKind as never, coder: coderKind as never },
    // Every minted id is declared by a hired seat, so this says nothing. A
    // warning on stderr here would mean the coder's declaration missed.
    channelBoards: channelBoardIds(channels)
  });

  const state = createFlowState({
    flows: {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat]))
    },
    stores: { default: { primary: inMemoryStores() } }
  } as never);

  try {
    const runtime = await state.getRuntime();
    await openChannels(channels, {
      client: {
        createSession: async (options: {
          flowKind: string;
          userId: string;
          sessionId?: string;
          orgId?: string;
          description?: string;
          state?: Record<string, unknown>;
        }) => {
          const id = String(options.sessionId);
          if ((await runtime.stores.session.get(id)) !== undefined) {
            throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
          }
          const now = Date.now();
          await runtime.stores.session.set(
            id,
            {
              id,
              flowKind: options.flowKind,
              flowId: options.flowKind,
              userId: options.userId,
              orgId: options.orgId,
              description: options.description,
              state: options.state ?? {},
              lineageId: `lin_${id}`,
              version: 0,
              createdAt: now,
              updatedAt: now,
              journal: []
            } as never,
            "absent"
          );
          return { id };
        },
        getSession: async (sessionId: string) => {
          const found = (await runtime.stores.session.get(sessionId)) as
            | { flowKind: string; flowId?: string; userId: string; orgId?: string; state?: Record<string, unknown> }
            | undefined;
          return {
            flowKind: String(found?.flowKind),
            flowId: found?.flowId,
            userId: String(found?.userId),
            orgId: found?.orgId,
            state: found?.state
          };
        },
        deleteSession: async (sessionId: string) => {
          await runtime.stores.session.delete(sessionId);
        }
      },
      userId: USER_ID,
      orgId: ORG_ID
    });

    const act = async (flow: unknown, sessionId: string, actionName: string, input: unknown) =>
      (await runAction({
        flow,
        actionName,
        input,
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown };

    const channelInstance = instances.find((instance) => instance.kind === CHANNEL_KIND)!;
    const em = seats.find((seat) => seat.kind === "em")!;
    const coder = seats.find((seat) => seat.kind === "coder")!;

    // ---- b. the channel says what it holds, by name -------------------------
    const view = await act(channelInstance, channel.id, "read", {});
    const held = (view.output as { boards?: string[] } | undefined)?.boards;
    if (JSON.stringify(held) !== JSON.stringify([boardName])) {
      failures.push(`the channel read listed ${JSON.stringify(held)}, not ["${boardName}"]`);
    }

    // ---- c. one seat files one row, through the channel ---------------------
    const goal = `wire the ${boardName} board end to end`;
    const filed = await act(em, `s_${em.id}`, "file", { goal });
    if (filed.error !== undefined) {
      failures.push(`the EM seat could not file a row: ${String(filed.error)}`);
    }

    // ---- d. the OTHER seat's board claims it and runs it --------------------
    // Nothing here names the row, the assignee or the worker: the drain is
    // handed nothing but a request to run.
    const drained = await act(coder, `s_${coder.id}`, "drain", {});
    if (drained.error !== undefined) {
      failures.push(`the coder seat's board could not drain: ${String(drained.error)}`);
    }

    const outbox = readFileSync(OUTBOX, "utf8").trim();
    if (outbox !== goal) {
      failures.push(`the work did not run: the outbox holds ${JSON.stringify(outbox)}`);
    }

    // ---- e. the row itself, read out of storage -----------------------------
    // Read from the ledger rather than from the drain's report, which would
    // say "1 task completed" whatever it actually wrote.
    const rows: Task[] = [];
    const boardRead = await act(channelInstance, channel.id, "readBoard", { board: boardName });
    for (const row of (boardRead.output as { tasks?: Task[] } | undefined)?.tasks ?? []) {
      rows.push(row);
    }
    if (rows.length !== 1) {
      failures.push(`expected exactly one row on the board, found ${rows.length}`);
    }
    const row = rows[0];
    if (row !== undefined) {
      if (row.status !== "completed") failures.push(`the row is ${row.status}, not completed`);
      if (row.goal !== goal) failures.push(`the row's goal is ${JSON.stringify(row.goal)}`);
      const stored = await runtime.stores.resourceState.get("org", ORG_ID, `${boardId}/${row.id}`);
      if (stored === undefined) {
        failures.push(`the row is not on the minted ledger "${boardId}"`);
      }
    }

    return {
      failures,
      evidence:
        `one tree at ${TREE}: channel "${channel.id}" declared board "${boardName}"; the ` +
        `framework minted "${boardId}", which appears in no file. The "em" seat filed one row ` +
        `through the channel's own action, the "coder" seat's board claimed and ran it — proved ` +
        `by ${OUTBOX}, a real side effect the board could not have produced by reporting — and ` +
        `the row reads completed out of org-scoped storage under the minted id. Nothing was ` +
        `dispatched by hand.`
    };
  } finally {
    await state.dispose();
  }
});
