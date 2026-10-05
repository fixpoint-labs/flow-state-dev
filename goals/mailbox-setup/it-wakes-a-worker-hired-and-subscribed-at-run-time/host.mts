/**
 * An app whose coordinator hires, sets up mailboxes, changes who is on them,
 * and files tasks while it runs, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files.
 * The coordinator is a worker on the built-in `agent` kind carrying the hire
 * tools and the mailbox-setup tools; its file names them in `tools:`. The
 * mailbox's wake is `wakeMemberSeats` over the registry, read on every post.
 * Hires written in an earlier run are reloaded from the store and registered
 * at boot, as any durable host does.
 *
 * Every agent answers from a scripted model, so the check needs no key: a
 * turn whose message is `call <tool> <json>` calls that tool once; any other
 * turn (a woken worker hearing a post) answers with a marker line.
 *
 * `wake` is the goal check's seam for its control, and nothing else: given the
 * workers the app declared at start and the registry's live list, it picks
 * which one the wake reads. An app passes nothing and gets the live list.
 */
import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, runAction, type FlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver, type MockGeneratorInstance, type MockGeneratorScriptStep } from "@flow-state-dev/testing";
import {
  createMailboxSetupCapability,
  createSeatHireCapability,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  defineProjectBlocks,
  hireWorkforce,
  mailboxInstances,
  openMailboxAtRunTime,
  openMailboxes,
  reloadHiredSeats,
  wakeMemberSeats,
  type HireOptions,
  type MailboxManifest,
  type MailboxWorkerSource,
  type RunTimeMailboxOpener
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

/** The user the mailboxes are opened under, and who talks to the coordinator. */
export const OWNER = "u_mailbox_setup";

/** The organization every request runs in. */
export const ORG_ID = DEFAULT_ORG_ID;

/** What a woken worker answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:mailbox-setup]";

/** The model every agent runs on: `call <tool> <json>` calls that tool once; anything else is answered. */
function scriptedModel(): MockGeneratorInstance {
  let cursor = new WeakMap<object, number>();
  return {
    name: "agent-answer",
    calls: [],
    reset: () => {
      cursor = new WeakMap();
    },
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const last = [...messages].reverse().find((m) => m.role === "user")?.content;
      const text = typeof last === "string" ? last : JSON.stringify(last ?? "");
      const directive = /^call (\w+) (\{.*\})$/s.exec(text);
      if (directive === null) return { text: `${REPLY_MARKER} noted.` };
      const step = cursor.get(messages) ?? 0;
      cursor.set(messages, step + 1);
      if (step > 0) return { text: "done" };
      return { toolCalls: [{ toolCallId: `tc_${step}_${Date.now()}`, toolName: directive[1]!, args: JSON.parse(directive[2]!) }] };
    }
  };
}

/** The app, booted. */
export interface MailboxSetupHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  /** The built mailbox kind, for its public actions. */
  mailbox: FlowInstance;
  mailboxes: MailboxManifest[];
  /** The workers declared in the files, by id. */
  declared: FlowInstance[];
  /** One turn of a declared worker's `run`, with `message`. Resolves to the run's error, if any. */
  say(workerId: string, message: string): Promise<string | undefined>;
  /** One project write (`createProject`, `setWorkstreams`) as a person calls it. Resolves to its output; rejects on a refusal. */
  project(action: string, input: unknown): Promise<unknown>;
}

/** The flow kind the app's project writes run on. */
const PROJECTS_KIND = "projects";

/**
 * Read the team's files, hire its workers, reload earlier hires, build the
 * mailboxes, and open them, over the SQLite file `file`.
 *
 * @param tree The workforce root to read.
 * @param file The SQLite file the app keeps everything in. A second boot over
 *   the same file is a restart.
 * @param wake The goal check's control seam. An app passes nothing.
 */
export async function startHost(
  tree: string,
  file: string,
  wake?: (boot: readonly FlowInstance[], live: () => readonly FlowInstance[]) => MailboxWorkerSource
): Promise<MailboxSetupHost> {
  const { workers, errors } = await readWorkforce(tree);
  const { mailboxes, errors: mailboxErrors } = await readMailboxesDirectory(tree);
  if (errors.length > 0 || mailboxErrors.length > 0) {
    throw new Error(`the tree did not load: ${[...errors, ...mailboxErrors].map((e) => e.path).join(", ")}`);
  }

  // Bound once the flow state exists: the hire's register, the registry the
  // wake and the name lookup read, and the mailbox opener.
  let state: FlowState | undefined;
  let registry: { get(id: string): FlowInstance | undefined; list(): FlowInstance[] } | undefined;
  let opener: RunTimeMailboxOpener | undefined;

  const kinds: NonNullable<HireOptions["kinds"]> = {};
  const hireTools = createSeatHireCapability({
    kinds,
    register: (worker, pin) => state!.register(worker, { pin }),
    unregister: (id) => state!.unregister(id),
    kindAt: (id) => registry?.get(id)?.kind
  });
  const live = (): readonly FlowInstance[] => registry?.list() ?? [];
  const mailboxSetup = createMailboxSetupCapability({
    open: () => opener!,
    workers: live
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [hireTools, mailboxSetup] });

  const declared = hireWorkforce(workers, { kinds });
  const notify = wakeMemberSeats(wake === undefined ? live : wake(declared, live));
  const mailboxFlows = mailboxInstances(mailboxes, {
    kinds: { mailbox: defineMailboxFlow({ notify, inventory: true }) }
  });
  const flows: Record<string, FlowInstance> = {
    [PROJECTS_KIND]: defineFlow({ kind: PROJECTS_KIND, actions: defineProjectBlocks().actions } as never)(),
    ...Object.fromEntries(mailboxFlows.map((flow) => [flow.kind, flow])),
    ...Object.fromEntries(declared.map((worker) => [worker.id, worker]))
  };

  state = createFlowState({
    flows,
    stores: { default: { primary: sqliteStores({ filename: file }) } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": scriptedModel() }, policy: "allow" })
  } as never);
  const runtime = await state.getRuntime();
  registry = runtime.registry as never;

  // The hires an earlier run made, back at their addresses.
  const reload = await reloadHiredSeats({ stores: runtime.stores, orgIds: [ORG_ID], kinds });
  if (reload.problems.length > 0) throw new Error(`hires did not reload: ${reload.problems.join("; ")}`);
  for (const worker of reload.seats) state.register(worker, { pin: worker.ownerPin ?? { orgId: ORG_ID } });

  const router = await state.getRouter();

  /** The session API `openMailboxes` takes, over the app's own store, as the session route behaves. */
  const client = {
    createSession: async (create: { flowKind: string; userId: string; sessionId?: string; description?: string; state?: Record<string, unknown> }) => {
      const id = String(create.sessionId);
      if ((await runtime.stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
      }
      const now = Date.now();
      await runtime.stores.session.set(
        id,
        {
          id,
          flowKind: create.flowKind,
          flowId: create.flowKind,
          userId: create.userId,
          orgId: ORG_ID,
          description: create.description,
          state: create.state ?? {},
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
        | { flowKind: string; flowId?: string; userId: string; state?: Record<string, unknown> }
        | undefined;
      if (found === undefined) throw Object.assign(new Error(`no session "${sessionId}"`), { status: 404 });
      return { flowKind: found.flowKind, flowId: found.flowId, userId: found.userId, state: found.state };
    },
    deleteSession: async (sessionId: string) => {
      await runtime.stores.session.delete(sessionId);
    }
  };
  await openMailboxes(mailboxes, { client, userId: OWNER });

  opener = openMailboxAtRunTime({
    client,
    userId: OWNER,
    // The teams the tree declares: the first half of every `<team>.<name>` id.
    teams: [...new Set([...mailboxes, ...workers].filter((r) => r.id.includes(".")).map((r) => r.id.split(".")[0]!))],
    run: async (request) => {
      const result = (await runAction({
        flow: flows[request.flowKind],
        actionName: request.action,
        input: request.input,
        userId: request.userId,
        orgId: request.orgId,
        sessionId: request.sessionId,
        source: request.source,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown };
      if (result.error !== undefined) throw result.error instanceof Error ? result.error : new Error(String(result.error));
      return result.output;
    }
  });

  const say = async (workerId: string, message: string) => {
    const result = (await runAction({
      orgId: ORG_ID,
      flow: flows[workerId],
      actionName: "run",
      input: { message },
      userId: OWNER,
      sessionId: `say_${workerId}_${Math.random().toString(36).slice(2)}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never)) as { error?: { message?: string } | string };
    if (result.error === undefined) return undefined;
    return typeof result.error === "string" ? result.error : String(result.error.message);
  };

  const project = async (action: string, input: unknown) => {
    const result = (await runAction({
      orgId: ORG_ID,
      flow: flows[PROJECTS_KIND],
      actionName: action,
      input,
      userId: OWNER,
      sessionId: PROJECTS_KIND,
      source: "http",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never)) as { output?: unknown; error?: unknown };
    if (result.error !== undefined) throw result.error instanceof Error ? result.error : new Error(String(result.error));
    return result.output;
  };

  return { state, router, mailbox: mailboxFlows[0]!, mailboxes, declared, say, project };
}
