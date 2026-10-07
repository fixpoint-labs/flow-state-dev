/**
 * Goal check — a team declared entirely in files has work filed onto its
 * mailbox's board by one seat and run to completion by another, which claimed
 * it rather than being handed it.
 *
 * **Model-free on purpose.** Nothing here is a judgment call: a row is filed,
 * a board drains it, a side effect happens or it does not. Putting a model in
 * the loop would add a way to fail that has nothing to do with the claim.
 *
 * What the tree contributes, and the code does not: the mailbox's id, the
 * board's local name, the members, and which seat runs which kind. The ledger
 * id is never written anywhere — it is minted from where the mailbox folder
 * sits, which is why leg 0 greps the whole tree for it and fails if it is
 * there.
 *
 * The tree holds more than this check reads: a second board nobody drains, a
 * third member whose seat hears posts, and a mailbox on a kind of its own.
 * `workforce-conventions/a-mailbox-holds-the-work-a-seat-drains` reads those;
 * here they only have to leave the row's path alone.
 *
 * Legs:
 *   0  the tree declares a local name and never an id
 *   a  the tree alone produces the roster, the instances and the seats
 *   b  the mailbox's own read lists the board it holds, by name
 *   c  one seat files one row through the mailbox — no board in its own code
 *   d  the other seat's board CLAIMS it and runs it, and the work really ran
 *   e  the row is completed on the minted ledger, read straight out of storage
 *
 * Run: pnpm tsx goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/run.mts
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  MAILBOX_KIND,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  hireWorkforce,
  openMailboxes,
  workerConfigSchema,
  type MailboxManifest,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { goalTmpDir, runGoal } from "../../lib/index.mts";

/** Every worker flow has one door: this fixture's answers by saying what it heard. */
const workerDoor = {
  message: {
    inputSchema: z.object({ message: z.string() }),
    userMessage: (input: { message: string }) => input.message,
    block: handler({
      name: "fixture-door",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ heard: z.string() }),
      execute: (input, ctx) => {
        ctx.emit.message(`Heard: ${input.message}`);
        return { heard: input.message };
      },
    }),
  },
};

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_mailbox_boards";
const ORG_ID = "org_mailbox_boards";

/** Where the drained worker leaves its proof. A real file, not a counter. */
const OUTBOX = join(goalTmpDir("mailbox-boards"), "ran.txt");

/**
 * Controls perturb THIS FILE, never the fixture tree — leg 0 reads the tree, so
 * a fixture edit would die there and prove only that leg 0 works.
 *
 *   by-name  the coder seat resolves the board under a DIFFERENT mailbox that
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
  const read = await readMailboxesDirectory(TREE);
  if (roster.errors.length > 0 || read.errors.length > 0) {
    return { failures: ["the tree did not load cleanly"], evidence: "" };
  }

  const workers: WorkerManifest[] = roster.workers;
  const mailboxes: MailboxManifest[] = read.mailboxes;
  // The mailbox that holds boards. The tree's other mailbox runs a kind of its
  // own, which holds none.
  const mailbox = mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (mailbox === undefined) return { failures: ["the tree declared no mailbox holding a board"], evidence: "" };

  // Read off the FILE, never hardcoded — swap the folder names and a correct
  // implementation still passes. The first board the file declares is the one
  // the coder drains.
  const boardNames = mailbox.declared.boards as string[];
  const boardName = boardNames[0]!;
  const triage = mailboxBoard(mailbox.id, boardName);
  const boardId = triage.id;
  if (!mailboxBoardIds(mailboxes).includes(boardId)) {
    return { failures: [`the roster mints no ledger "${boardId}" for the board the file declares`], evidence: "" };
  }

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
    actions: { ...workerDoor,
      file: {
        // The EM has no board, no collection and no drain — the one line that
        // reaches the work is a dispatch into the mailbox's own session.
        block: dispatcher({
          name: "em-file-row",
          flowKind: MAILBOX_KIND,
          action: "fileTask",
          inputSchema: z.object({ goal: z.string() }),
          session: { id: () => mailbox.id },
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
  // mailbox made; under `by-name` it is another mailbox's board of the same
  // name, so "the names match" stops being enough.
  const seatBoard = CONTROL === "by-name" ? mailboxBoard("other.team", boardName) : triage;

  const board = taskBoard({
    name: "mailbox-triage",
    boardId: "mailbox-triage",
    collection: seatBoard,
    concurrency: 1,
    workers: { coder: ran }
  });

  const coderKind = defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    // The whole of what a seat declares to reach the mailbox's ledger.
    resources: { [seatBoard.id]: seatBoard },
    actions: { ...workerDoor, drain: { block: board.drain } }
  } as never);

  // The generated module carries the tree's own mailbox kind, which the other
  // mailbox names.
  const generated = (await import(pathToFileURL(join(TREE, "workforce.gen.ts")).href)) as {
    mailboxKinds: Record<string, never>;
  };
  const instances = mailboxInstances(mailboxes, { kinds: generated.mailboxKinds });
  const seats = hireWorkforce(workers, {
    workerFlows: { em: emKind as never, coder: coderKind as never },
    // One warning on stderr is expected, naming the board nobody drains. A
    // warning naming the coder's board would mean its declaration missed.
    mailboxBoards: mailboxBoardIds(mailboxes)
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
    await openMailboxes(mailboxes, {
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
              // `openMailboxes` no longer names an org (FIX-1442); this
              // stand-in for the session route binds what the real route binds.
              orgId: options.orgId ?? ORG_ID,
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

    const mailboxInstance = instances.find((instance) => instance.kind === MAILBOX_KIND)!;
    const em = seats.find((seat) => seat.kind === "em")!;
    const coder = seats.find((seat) => seat.kind === "coder")!;

    // ---- b. the mailbox says what it holds, by name -------------------------
    const view = await act(mailboxInstance, mailbox.id, "read", {});
    const held = (view.output as { boards?: string[] } | undefined)?.boards;
    // Sorted on both sides: the framework sorts the ledgers a kind is built with.
    if (JSON.stringify(held) !== JSON.stringify([...boardNames].sort())) {
      failures.push(`the mailbox read listed ${JSON.stringify(held)}, not ${JSON.stringify([...boardNames].sort())}`);
    }

    // ---- c. one seat files one row, through the mailbox ---------------------
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
    const boardRead = await act(mailboxInstance, mailbox.id, "readBoard", { board: boardName });
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
        `one tree at ${TREE}: mailbox "${mailbox.id}" declared board "${boardName}"; the ` +
        `framework minted "${boardId}", which appears in no file. The "em" seat filed one row ` +
        `through the mailbox's own action, the "coder" seat's board claimed and ran it — proved ` +
        `by ${OUTBOX}, a real side effect the board could not have produced by reporting — and ` +
        `the row reads completed out of org-scoped storage under the minted id. Nothing was ` +
        `dispatched by hand.`
    };
  } finally {
    await state.dispose();
  }
});
