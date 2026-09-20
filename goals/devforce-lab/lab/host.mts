/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed honesty check drive the *same* tree, the same hire
 * and the same wiring, and differ by one block.
 *
 * What `openLab` does, in order, and nothing else: read the tree, build the two
 * kinds, hire, register, hand back the handles. Every convention file it reads
 * is found by walking from one root; no file is named in this code.
 *
 * Three pieces here are the lab's rather than the framework's, each because the
 * framework has no opinion at that spot:
 *
 * 1. **The board and its address map** (`board.mts`). The loader walks four
 *    folders and silently ignores the rest, so a board declared as a tree
 *    folder would load as nothing — which is BR-16, and why boards live in code.
 * 2. **The assignee → seat address.** A board's `workers` keys are assignees,
 *    not Workforce seats; which seat an assignee reaches is a dispatcher's
 *    `flowKind`, and it is a static instance id rather than a lookup. The
 *    caller supplies it, which is also what lets a control point it at the
 *    wrong seat and watch the negative claim go red.
 * 3. **The harness slot**, handed to the `coder` kind. The one expression that
 *    differs between this lab's two checks.
 *
 * **Not `workforce.gen.ts`.** `fsdev gen` renders that file for an app
 * directory, and `goals/` is not one. The kinds are hand-assembled here, which
 * FIX-1357's own contract says composes with a generated map rather than being
 * deprecated by it. `goals/pentest-lab/lab/host.mts` does the same, for the same
 * reason.
 */

import { createFlowState, runAction } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { hireWorkforce, resourcesFromDocs } from "@flow-state-dev/workforce";
import {
  readDeclaredRoster,
  type DeclaredRoster,
} from "@flow-state-dev/workforce/loader";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { fileURLToPath } from "node:url";
import { LEDGER_ID } from "./board.mts";
import { INSPECT_ENTRY } from "./seat-config.mts";
import { implementPhase } from "./phase.mts";
import { CODER_KIND, defineCoderWorkerFlow } from "./workforce/flows/workers/coder.mts";
import {
  DRAIN_ENTRY,
  EM_KIND,
  FILE_ENTRY,
  defineEmWorkerFlow,
} from "./workforce/flows/workers/em.mts";
import type { HarnessStub } from "./harness-stub.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the lab runs as, and the org every document read is bound to. */
export const LAB_USER_ID = "u_devforce_lab";
export const LAB_ORG_ID = "org_devforce_lab";

/**
 * Read a workforce tree into records, refusing a tree that did not load
 * cleanly.
 *
 * The shared reader collects rather than throws, which is right for a library
 * and wrong here: a seat that failed to load is a seat this lab does not have,
 * and a short roster that still runs is the failure BR-2 exists to exclude. The
 * refusal is this lab's own policy, which is why it lives here and not behind
 * the export.
 */
async function loadTree(root: string): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((p) =>
      p.worker === undefined
        ? `${p.layer} ${p.path}: ${p.error.message}`
        : `${p.layer} ${p.path} (seat ${p.worker}): ${p.error.message}`,
    );
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  return roster;
}

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` is enough. */
  stores: unknown;
  /** The harness the `coder` kind runs. The one thing the two checks differ by. */
  harness: HarnessStub["slot"];
  /** Where checkouts are cut, from what repository, off which ref. */
  workspace: { root: string; sourceRepo: string; baseRef: string };
  /**
   * The seat instance id the board's `coder` assignee is addressed to.
   *
   * The address map is the app's, not the tree's. Supplied by the caller for
   * that reason — and because a control that points it at the wrong declared
   * seat is the only way "the row reached the seat it named" can be made to go
   * red.
   */
  coderSeatId: string;
  /** Wall-clock budget for one harness run. Default 60s. */
  runTimeoutMs?: number;
  /** The tree to read. Defaults to the lab's own. */
  root?: string;
  /** Silence the engine's own logging. */
  logger?: unknown;

  // ---- controls, each the red state of one claim -------------------------

  /**
   * Repoint a seat at a different file-declared document, by seat id.
   *
   * Applied to the RECORD before the mint, so the seat genuinely runs on the
   * other ref rather than being graded as if it did. That is what makes it a
   * control: the prompt the manager builds then carries the wrong document's
   * token, which is the failure BR-10 exists to detect.
   */
  documentOverrides?: Record<string, string>;
  /**
   * Rewrite one seat's resolved skill union before the mint.
   *
   * Applied to the record for the same reason, so the seat genuinely hires with
   * the mutated set and reads it back through its own config.
   */
  mutateSkills?: (seatId: string, skills: SeatSkill[]) => SeatSkill[];
}

/** One skill on a worker record, as the loader shapes it. */
export interface SeatSkill {
  name: string;
  skillMd: string;
  files?: Array<{ path: string; content: string }>;
}

/** Everything a check needs to drive and observe one lab. */
export interface Lab {
  roster: DeclaredRoster;
  /** The hired seats, by id. */
  seats: Record<string, FlowInstance>;
  /** File one row through the EM seat's own action. */
  file(
    seatId: string,
    input: { issue: string; goal: string; maxAttempts?: number },
  ): Promise<{ output?: unknown; error?: string }>;
  /** Run the board through the EM seat's own action, and wait for it to return. */
  drain(seatId: string): Promise<{ output?: unknown; error?: string }>;
  /** Read one row out of the durable ledger. */
  row(taskId: string): Promise<Task | undefined>;
  /**
   * Every child session the EM seat's drain started, with the flow it was
   * attributed to — the **dispatch record**.
   *
   * This is what BR-6 and BR-8 are graded on. A seat's absence from a result
   * says nothing: a stray dispatch whose run produced nothing would be
   * indistinguishable from no dispatch at all.
   */
  dispatched(
    seatId: string,
  ): Promise<Array<{ sessionId: string; flowKind: string; flowId: string | undefined }>>;
  /**
   * Read one seat's own view of itself.
   *
   * `omitOrg` sends the request through the transport door with no org at all,
   * which BR-17 says is refused before anything runs. The refusal is returned
   * rather than thrown, so it can be graded on its wording.
   */
  inspect(
    seatId: string,
    options?: { omitOrg?: boolean },
  ): Promise<{ facts?: Record<string, unknown>; error?: string }>;
  dispose(): Promise<void>;
}

/**
 * Read the tree, build the kinds, hire, and register.
 *
 * @param options The stores, the harness slot, the workspace and the address.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any record refuses at the mint —
 *   which is BR-2, and deliberately fatal: nothing is hired, nothing registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const roster = await loadTree(options.root ?? LAB_TREE);

  // The documents, as the L1 resource map a flow installs. Org-scoped, which is
  // what makes the seats' `requireOrg: true` reads — and BR-17 — matter.
  const resources = resourcesFromDocs(roster.documents);

  // The controls mutate the RECORD, before the mint, so a perturbed seat
  // genuinely runs on what the control gave it rather than being graded as if
  // it did.
  const overrides = options.documentOverrides ?? {};
  const workers = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(overrides, worker.id)) declared.document = overrides[worker.id];
    const redirected = { ...worker, declared };
    return options.mutateSkills === undefined
      ? redirected
      : {
          ...redirected,
          skills: options.mutateSkills(redirected.id, (redirected.skills ?? []) as SeatSkill[]),
        };
  });

  const emKind = defineEmWorkerFlow({ coderSeatId: options.coderSeatId, resources });
  const coderKind = defineCoderWorkerFlow({
    harness: options.harness,
    workspace: options.workspace,
    phase: implementPhase,
    runTimeoutMs: options.runTimeoutMs ?? 60_000,
    resources,
  });

  // Refuses the WHOLE roster when any record cannot be hired, naming the
  // worker. Nothing is returned partially, so a refusal cannot leave a short
  // roster running.
  const hired = hireWorkforce(workers, {
    kinds: { [EM_KIND]: emKind as never, [CODER_KIND]: coderKind as never },
  });
  const seats: Record<string, FlowInstance> = Object.fromEntries(
    hired.map((seat) => [seat.id, seat]),
  );

  const state = createFlowState({
    flows: Object.fromEntries(hired.map((seat) => [seat.id, seat])),
    stores: { default: { primary: options.stores } },
    ...(options.logger === undefined ? {} : { runtimeConfig: { logger: options.logger } }),
  } as never);

  const router = await state.getRouter();
  const runtime = await state.getRuntime();

  // `createFlowState` builds its own `RuntimeConfig` and takes no logger
  // option, and a hand-off's child request is started from that resolved object
  // rather than from anything a caller passes per action. Setting it here is
  // the one place that reaches both.
  if (options.logger !== undefined) {
    (runtime.runtimeConfig as { logger?: unknown }).logger = options.logger;
  }

  /** The session the EM seat's actions run in — one per seat, stable across a run. */
  const sessionFor = (seatId: string): string => `s_${seatId.replace(/\./g, "_")}`;

  /**
   * Run one action and hand back what it returned.
   *
   * `runAction` rather than the HTTP route, for one reason: the route is
   * fire-and-forget (202 plus a request id) and the request record carries no
   * output, so reading an action's result off it is not a thing that works.
   * This is the same entry the route dispatches into.
   */
  const act = async (
    seatId: string,
    actionName: string,
    input: unknown,
  ): Promise<{ output?: unknown; error?: string }> => {
    const seat = seats[seatId];
    if (seat === undefined) throw new Error(`no seat "${seatId}" was hired`);
    try {
      const result = (await runAction({
        flow: seat,
        actionName,
        input,
        userId: LAB_USER_ID,
        orgId: LAB_ORG_ID,
        sessionId: sessionFor(seatId),
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: unknown; error?: unknown };
      return result.error === undefined
        ? { output: result.output }
        : { error: messageOf(result.error) };
    } catch (error) {
      // A refusal the substrate throws rather than returns. Returned like any
      // other refusal, so a leg that expects one grades its wording instead of
      // taking the run down.
      return { error: messageOf(error) };
    }
  };

  return {
    roster: { ...roster, workers },
    seats,

    file: (seatId, input) => act(seatId, FILE_ENTRY, input),
    drain: (seatId) => act(seatId, DRAIN_ENTRY, {}),

    row: async (taskId: string) => {
      const record = await runtime.stores.resourceState.get(
        "user",
        LAB_USER_ID,
        `${LEDGER_ID}/${taskId}`,
      );
      return record?.state as Task | undefined;
    },

    dispatched: async (seatId: string) => {
      const children = await runtime.stores.session.list({
        userId: LAB_USER_ID,
        parentage: { parentOf: sessionFor(seatId) },
      });
      // **`flowId`, not just `flowKind`.** Two seats on this tree are hired
      // into the SAME kind — the coder and the never-woken reviewer — so a
      // dispatch record read by kind alone cannot tell them apart, and BR-8's
      // whole claim is which of the two the row reached.
      return (children as Array<{ id: string; flowKind: string; flowId?: string }>).map(
        (child) => ({ sessionId: child.id, flowKind: child.flowKind, flowId: child.flowId }),
      );
    },

    inspect: async (seatId: string, inspectOptions?: { omitOrg?: boolean }) => {
      if (seatId in seats === false) throw new Error(`no seat "${seatId}" was hired`);

      // BR-17 is about the DOOR, and the door is the transport host: a bare
      // `runAction` never reaches `validateDispatch`, so an org-less one runs
      // happily — and, because a file-declared document's body is static
      // content rather than stored state, it even reads the document. The
      // refusal this rule names therefore has to be asked for where it lives.
      if (inspectOptions?.omitOrg === true) {
        // A session id nothing has used, and that is load-bearing:
        // `validateDispatch` satisfies a flow's `requiresOrg` from an EXISTING
        // session's stored org binding. Reusing the ordinary session would hand
        // the request the very org this probe is withholding, and the refusal
        // would never fire — a green that means nothing.
        const segments = [seatId, `no-org-${seatId}`, "actions", INSPECT_ENTRY];
        const request = new Request(`http://lab/api/flows/${segments.join("/")}`, {
          method: "POST",
          body: JSON.stringify({ userId: LAB_USER_ID, input: {} }),
        });
        const response = await (router as any).POST(request, { params: { path: segments } });
        const text = await response.text();
        const json = text.length > 0 ? JSON.parse(text) : undefined;
        return response.status >= 400
          ? { error: `${response.status}: ${JSON.stringify(json)}` }
          : { facts: (json ?? {}) as Record<string, unknown> };
      }

      const result = await act(seatId, INSPECT_ENTRY, {});
      return result.error === undefined
        ? { facts: (result.output ?? {}) as Record<string, unknown> }
        : { error: result.error };
    },

    dispose: () => state.dispose(),
  };
}

/** One wording for whatever a refusal turns out to be. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
