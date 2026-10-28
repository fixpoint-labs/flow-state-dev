/**
 * A worker flow's roles, and the one table of the entries each role needs.
 *
 * Every worker takes a user's message on `respond` (`./worker-door`). Beside
 * that, a worker flow declares what else it does, with its registration
 * (`workerFlow(build, { roles })` or a `workerFlows` entry `{ flow, roles }`):
 *
 * - `contributor` takes tasks, on the `work` task entry `workerTaskEntry`
 *   builds;
 * - `manager` runs its delegation board, on the `dispatch` and
 *   `onTaskSettled` internal entries `defineSessionBoard` builds;
 * - `coordinator` is a manager that routes messages: a manager's entries,
 *   plus `routeOn`, `roundDeadline` and `changeWorkstreamDelegate`, which
 *   only `defineCoordinatorFlow` builds.
 *
 * The hire checks both ways ({@link roleProblems}): a declared role's entries
 * are there, in their section, built by the role's factory, and take what
 * their caller sends; and no piece of a role's factory sits on a flow that
 * doesn't declare that role. Both read the factory's mark, never a bare name,
 * so a flow's own unmarked `dispatch` or `work` is its own action.
 *
 * This table is the only place that lists a role's entries: the hire's
 * contract check, `workerFlowProblems` and the delegate check all read it.
 * A leaf over the entry names' own leaves, so the factories import their mark
 * from here without importing the table's readers.
 */
import { DISPATCH_ENTRY, TASK_SETTLED_ENTRY } from "./conversation-board/board-entries";
import { ROUND_DEADLINE_ACTION, ROUTE_ON_ACTION, WORKSTREAM_DELEGATE_ACTION } from "./coordinator/coordinator-keys";
import { WORKER_TASK_ENTRY, takesConversationTasks } from "./worker-task-entry";

/** The roles a worker flow may declare, beside every worker's door. */
export const WORKER_ROLES = ["contributor", "manager", "coordinator"] as const;

/** One of {@link WORKER_ROLES}. */
export type WorkerRole = (typeof WORKER_ROLES)[number];

/**
 * The mark on what a role's factory builds: an entry, or an action the
 * factory spreads. Enumerable, so it survives the spreads a flow is built
 * with; a registered symbol, so two installed copies of this package read each
 * other's mark. The contributor's `work` keeps its own older mark, on its
 * binding (`takesConversationTasks`).
 */
const ROLE_PIECE = Symbol.for("@flow-state-dev/workforce/role-piece");

/** Mark `piece` as built by `role`'s factory. Returns it. */
export function markRolePiece<T extends object>(piece: T, role: WorkerRole): T {
  (piece as Record<symbol, unknown>)[ROLE_PIECE] = role;
  return piece;
}

/** The role whose factory built `piece`, or `undefined` for a flow's own entry. */
function rolePieceOf(piece: unknown): WorkerRole | undefined {
  if (typeof piece !== "object" || piece === null) return undefined;
  return (piece as Record<symbol, WorkerRole | undefined>)[ROLE_PIECE];
}

/**
 * What each role entry's caller sends it, for the entry's input schema to be
 * probed with: core's task envelope for `work`, orchestration's notice for
 * `onTaskSettled`, nothing for a pass or a deadline. A test keeps each parsing
 * against its source schema. A probe runs no block.
 */
export const ROLE_PROBES = Object.freeze({
  [WORKER_TASK_ENTRY]: {
    boardId: "tasks",
    assignee: "worker-role-probe",
    taskId: "worker-role-probe",
    attempt: 0,
    createdAt: 0,
    payload: { taskId: "worker-role-probe", goal: "probe", attempts: 0 }
  },
  [DISPATCH_ENTRY]: {},
  [TASK_SETTLED_ENTRY]: { boardId: "tasks", taskId: "worker-role-probe", attempt: 0, ending: "completed" },
  [ROUTE_ON_ACTION]: { postId: "worker-role-probe", round: 1, answers: [] },
  [ROUND_DEADLINE_ACTION]: {},
  [WORKSTREAM_DELEGATE_ACTION]: { change: "add", worker: "worker-role-probe", target: "worker-role-probe" }
} as const);

type Section = "task" | "internal";

/** One entry a role needs. */
interface RoleEntry {
  readonly name: keyof typeof ROLE_PROBES;
  readonly section: Section;
  /** Whether `entry` is the one the role's factory built. */
  readonly built: (entry: unknown) => boolean;
}

/** One role: its entries, the factory that brings them, and how to spread it. */
interface RoleRow {
  readonly entries: readonly RoleEntry[];
  readonly factory: string;
  readonly fix: string;
}

const markedBy =
  (role: WorkerRole) =>
  (entry: unknown): boolean =>
    rolePieceOf(entry) === role;

/** Whether a `task` entry is `workerTaskEntry`'s: its binding carries the conversation-task mark. */
const isWorkerTaskEntry = (entry: unknown): boolean =>
  takesConversationTasks({ task: { actions: { [WORKER_TASK_ENTRY]: entry } } });

const MANAGER_ENTRIES: readonly RoleEntry[] = [
  { name: DISPATCH_ENTRY, section: "internal", built: markedBy("manager") },
  { name: TASK_SETTLED_ENTRY, section: "internal", built: markedBy("manager") }
];

/** The table. The coordinator's row is a manager's, plus its own three. */
const ROLE_TABLE: Readonly<Record<WorkerRole, RoleRow>> = {
  contributor: {
    entries: [{ name: WORKER_TASK_ENTRY, section: "task", built: isWorkerTaskEntry }],
    factory: "workerTaskEntry",
    fix: `Build it with \`workerTaskEntry\`: \`task: { actions: { ${WORKER_TASK_ENTRY}: workerTaskEntry({ name, turn }) } }\`.`
  },
  manager: {
    entries: MANAGER_ENTRIES,
    factory: "defineSessionBoard",
    fix: "Build them with `defineSessionBoard`: spread `board.entries(turn)` into `internal.actions`."
  },
  coordinator: {
    entries: [
      ...MANAGER_ENTRIES,
      { name: ROUTE_ON_ACTION, section: "internal", built: markedBy("coordinator") },
      { name: ROUND_DEADLINE_ACTION, section: "internal", built: markedBy("coordinator") },
      { name: WORKSTREAM_DELEGATE_ACTION, section: "internal", built: markedBy("coordinator") }
    ],
    factory: "defineCoordinatorFlow",
    fix: "Only `defineCoordinatorFlow` builds a coordinator: run its workers on that flow."
  }
};

type SchemaLike = { safeParse?: (value: unknown) => { success: boolean } };
type EntryLike = { inputSchema?: SchemaLike; block?: { inputSchema?: SchemaLike } };

/** Whether `entry`'s input schema takes `probe`. An entry with no schema takes anything. */
function takesProbe(entry: EntryLike, probe: unknown): boolean {
  const schema = entry.inputSchema ?? entry.block?.inputSchema;
  return typeof schema?.safeParse !== "function" || schema.safeParse(probe).success;
}

type FlowLike = {
  actions?: Readonly<Record<string, unknown>>;
  internal?: { actions?: Readonly<Record<string, unknown>> };
  task?: { actions?: Readonly<Record<string, unknown>> };
};

function sectionOf(flow: FlowLike, section: Section | "actions"): Readonly<Record<string, unknown>> {
  if (section === "actions") return flow.actions ?? {};
  return flow[section]?.actions ?? {};
}

const SECTION_NAME: Record<Section, string> = { task: "task entry", internal: "internal entry" };

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(", ");

/** Whether `declared` covers a piece of `role`'s factory: the role itself, or a coordinator's manager pieces. */
function covers(declared: readonly WorkerRole[], role: WorkerRole): boolean {
  return declared.includes(role) || (role === "manager" && declared.includes("coordinator"));
}

/**
 * Every way `flow`, registered as `name` with `roles`, misses its roles — or an
 * empty list. One sentence per role, each naming the flow, the role, the
 * entries and the fix.
 *
 * @param name The name the flow is registered under.
 * @param flow The flow definition.
 * @param roles The roles its registration declares.
 */
export function roleProblems(name: string, flow: unknown, roles: readonly unknown[]): string[] {
  const problems: string[] = [];
  const unknownRoles = roles.filter((role) => !(WORKER_ROLES as readonly unknown[]).includes(role));
  if (unknownRoles.length > 0) {
    problems.push(
      `worker flow "${name}" declares ${unknownRoles.map((role) => JSON.stringify(role)).join(", ")} in \`roles\`, ` +
        `which ${unknownRoles.length === 1 ? "isn't a role" : "aren't roles"}. The roles are ${quoted(WORKER_ROLES)}.`
    );
  }
  const declared = roles.filter((role): role is WorkerRole => (WORKER_ROLES as readonly unknown[]).includes(role));
  const definition = flow as FlowLike;

  // Each declared role's entries: there, the factory's, and taking their input.
  for (const role of WORKER_ROLES.filter((r) => declared.includes(r))) {
    const row = ROLE_TABLE[role];
    const missing: string[] = [];
    const notBuilt: string[] = [];
    const refusing: string[] = [];
    for (const entry of row.entries) {
      const found = sectionOf(definition, entry.section)[entry.name];
      if (found === undefined) missing.push(`no ${SECTION_NAME[entry.section]} "${entry.name}"`);
      else if (!entry.built(found)) notBuilt.push(entry.name);
      else if (!takesProbe(found as EntryLike, ROLE_PROBES[entry.name])) refusing.push(entry.name);
    }
    const parts: string[] = [...missing];
    if (notBuilt.length > 0) parts.push(`${quoted(notBuilt)} ${notBuilt.length === 1 ? "isn't" : "aren't"} \`${row.factory}\`'s`);
    if (refusing.length > 0) parts.push(`${quoted(refusing)} ${refusing.length === 1 ? "refuses" : "refuse"} the input ${refusing.length === 1 ? "its" : "their"} caller sends`);
    if (parts.length === 0) continue;
    problems.push(`worker flow "${name}" declares the "${role}" role, and has ${parts.join(", and ")}. ${row.fix}`);
  }

  // Every piece of a role's factory, on a flow that doesn't declare the role.
  const pieces = new Map<WorkerRole, string[]>();
  const note = (role: WorkerRole, piece: string): void => {
    if (covers(declared, role)) return;
    pieces.set(role, [...(pieces.get(role) ?? []), piece]);
  };
  for (const section of ["actions", "internal", "task"] as const) {
    for (const [entryName, entry] of Object.entries(sectionOf(definition, section))) {
      const role = rolePieceOf(entry);
      if (role !== undefined) note(role, entryName);
      else if (section === "task" && entryName === WORKER_TASK_ENTRY && isWorkerTaskEntry(entry)) note("contributor", entryName);
    }
  }
  for (const role of WORKER_ROLES) {
    const found = pieces.get(role);
    if (found === undefined) continue;
    problems.push(
      `worker flow "${name}" carries ${quoted(found)}, built by \`${ROLE_TABLE[role].factory}\` for the "${role}" role, ` +
        `but doesn't declare "${role}". Declare it in its registration's \`roles\` ` +
        `(\`workerFlow(build, { roles: ["${role}"] })\` or \`{ flow, roles: ["${role}"] }\`), or leave the pieces off.`
    );
  }
  return problems;
}

/**
 * The roles a built-in worker flow declares itself, so an app registering it
 * as a plain flow doesn't restate them. Internal: an app's own flow declares
 * its roles with its registration.
 */
const BUILT_IN_ROLES = Symbol.for("@flow-state-dev/workforce/built-in-roles");

/** Record the roles a built-in flow declares. Returns it. */
export function declareBuiltInRoles<T extends object>(flow: T, roles: readonly WorkerRole[]): T {
  Object.defineProperty(flow, BUILT_IN_ROLES, { value: Object.freeze([...roles]) });
  return flow;
}

/** The roles a built-in flow declared itself, or `undefined` for any other flow. */
export function builtInRolesOf(flow: unknown): readonly WorkerRole[] | undefined {
  if ((typeof flow !== "object" && typeof flow !== "function") || flow === null) return undefined;
  return (flow as Record<symbol, readonly WorkerRole[] | undefined>)[BUILT_IN_ROLES];
}

/**
 * Whether a registered worker flow takes tasks: it declares `contributor`.
 * The hire guarantees the entry behind it. The one answer to which flows take
 * routed or filed work.
 */
export function takesTasks(resolved: { readonly roles?: readonly string[] } | undefined): boolean {
  return resolved?.roles?.includes("contributor") === true;
}
