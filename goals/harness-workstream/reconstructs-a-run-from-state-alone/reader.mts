/**
 * The deprived reader: FSD state in, an account of the run out.
 *
 * Its ONLY input is `read` — a bound reader for one host's HTTP routes. It has
 * no filesystem, no process, no git, and no way to reach the harness
 * transcript, because it has no way to reach anything it was not handed. That
 * is a parameter shape, not a promise: nothing here has to be trusted not to
 * peek, and `run.mts` asserts the deprivation mechanically over this file's own
 * source (assertion 8), which is why the import list below is exactly one line.
 *
 * ## Derive, then compare — never search
 *
 * Nothing in this module knows what the run was ASKED to do. It reads the
 * state, builds an account of what it finds, and hands it over. The expectation
 * meets the account for the first time in `grader.mts`. That inversion is the
 * whole difference from the two checks we already have, which go looking for a
 * value they already hold and therefore pass on a record that kept only the
 * fraction they asked about.
 *
 * It follows that the account may report things nobody asked about — a file the
 * job never named, a gap, a tool nobody expected. Those are reported, never
 * graded here.
 *
 * ## Which items feed which derivation, and why they differ
 *
 * - **Activity** — file mutations, shell calls, plan-tool calls — is scanned
 *   over EVERY item, not just top-level ones. A sub-agent's items nest under a
 *   container via `ownedBy`, and the recorder does not filter on that, so a
 *   top-level-only scan would see a collection row whose mutation "is missing
 *   from the stream" and report the graph as having invented a write.
 * - **Narrative and order** — what the run said, and the stream's own sequence
 *   — are top-level only. Those are the run's own thread; a sub-agent's
 *   interleaved chatter is not part of it.
 *
 * ## Two field traps, both measured
 *
 * - The ordering key is `itemIndex`. `seq` does not exist on a persisted item,
 *   and reading it yields an empty set that every `every()` passes vacuously —
 *   the exact fail-green shape this goal exists to rule out.
 * - A row's payload is on `clientData`, not `state`, and `clientData` is a
 *   PROJECTION: a field the collection does not expose reads `undefined` after
 *   a perfectly valid 200. Absence is reported as absence, never as a value.
 *
 * A tool result's `output` is the prose shown to the model, not a structured
 * result. Nothing here parses it. Paths come from `toolCall.arguments`, which
 * is a JSON string carrying the tool's real input.
 */
import { OBSERVED_FILE_OPS, OBSERVED_GAPS, OBSERVED_PLAN } from "@flow-state-dev/claude-code/sdk";
import { namespaceFor, sameFile } from "./paths.mts";

/**
 * The reader's whole world: one bound route reader for one host.
 *
 * It must throw on anything that is not a 2xx answer. A swallowed transport
 * error would arrive here as an empty page, and an empty page is graded as a
 * failure with a reason — so a dead host would be reported as a lossy graph.
 */
export type Read = (path: string) => Promise<unknown>;

/**
 * THE VENDOR EDGE, and the only place in this module that knows a tool name.
 *
 * Must match the recorder's shipped table (`FILE_MUTATION_TOOLS` in
 * `packages/claude-code/src/sdk/translate.ts`). It is not imported because the
 * recorder does not export it, and exporting it to satisfy a check would be
 * widening the package's public surface for a test. If the two ever disagree,
 * assertion 2 goes red in both directions at once, which is the loudest failure
 * available and is the intended outcome.
 *
 * Used for exactly two things: the stream-versus-collection agreement check,
 * and the shell-call flag. Nothing else here knows a tool name.
 */
export const FILE_MUTATION_TOOLS: Record<string, string> = { Write: "created", Edit: "edited" };

/**
 * How a settled tool result maps to the outcome a row should carry. Framework
 * vocabulary on both sides; an item status we do not list yields no expectation
 * rather than a wrong one.
 */
const OUTCOME_OF_STATUS: Record<string, string> = { completed: "applied", failed: "failed" };
/** The shell. Its edits are invisible to the recorder by design, not by defect. */
export const SHELL_TOOL = "Bash";
/**
 * The run's own to-do surface. Read ONLY to tell "the run never planned" from
 * "the plan tools fired and nothing was recorded" — the two empties that need
 * opposite verdicts. Reading our own item stream is not the anti-game; the
 * prohibition is on the harness transcript.
 */
export const PLAN_TOOLS = ["TaskCreate", "TaskUpdate"] as const;

/** One page of a collection, as the list-collection-state route returns it. */
interface CollectionPage {
  items?: Array<{ topic?: string; storageKey?: string; clientData?: Record<string, unknown> }>;
  nextCursor?: string;
}

/** The slice of a persisted item this reader reads. */
interface StoredItem {
  type?: string;
  itemIndex?: number;
  ownedBy?: string;
  status?: string;
  content?: Array<{ text?: string }>;
  /** A JSON string of the tool's real input. `output` is prose and is not read. */
  toolCall?: { name?: string; arguments?: unknown };
}

interface StoredRequest {
  id?: string;
  status?: string;
  items?: StoredItem[];
}

/** One mutation the run's own item stream shows. */
export interface StreamMutation {
  /**
   * Which run made it. Pairing is scoped to this: a workstream is reused, so
   * two requests touching the same path both name it, and matching against the
   * combined set would read every correctly-namespaced row as ambiguous. That
   * is a false red on a faithful record — as bad as a false green, just failing
   * in the direction that wastes time rather than lies.
   */
  runId: string;
  /** The path exactly as the tool call named it — raw, uncanonicalized. */
  path: string;
  tool: string;
  at: number | null;
  /** `completed` / `failed` as the item recorded it. Never parsed from prose. */
  status: string | null;
  /**
   * What the record SHOULD say about this mutation, translated here so no
   * assertion has to know a tool name. The grader compares these against the
   * row's own `kind` and `outcome`: a record that stores an `Edit` as `created`,
   * or a failed result as `applied`, is wrong about what happened even though
   * every field is populated and settled. Both were real defects in the recorder.
   */
  kind: string;
  /** Null when the item carries no terminal status, so nothing is claimed. */
  outcome: string | null;
}

/** One path the file-op collection says the run touched. */
export interface DidEntry {
  runId: string;
  /**
   * The row's own key, verbatim and unparsed. This is the row's IDENTITY — every
   * comparison runs against it by trailing path segments, which is what makes
   * the check indifferent to how many namespace segments precede the path.
   */
  topic: string;
  /**
   * The path as the run's tool call spelled it, taken from the matching stream
   * mutation. Null when the stream never named this row — which A2 grades, and
   * which is why the path is not recovered from the key instead.
   */
  path: string | null;
  /** `created` / `edited`, or null when the projection does not carry it. */
  kind: string | null;
  /** `pending` / `applied` / `failed`, or null when not carried. */
  outcome: string | null;
  /** First `itemIndex` in the stream naming this row; null unless exactly one did. */
  firstAt: number | null;
  /**
   * How many stream mutations name this row. Anything but 1 is unresolvable and
   * is graded, never silently picked — see `paths.mts`. `path` and `firstAt`
   * stay null unless this is exactly 1.
   */
  namedBy: number;
}

/** One thing the recorder recognised and could not record. */
export interface GapEntry {
  runId: string;
  reason: string | null;
  rawPath: string | null;
}

/** One item on the run's own to-do list. */
export interface PlanEntry {
  runId: string;
  title: string | null;
  status: string | null;
  previousStatus: string | null;
}

/** One thing the run said, top-level, in stream order. */
export interface SaidEntry {
  at: number | null;
  text: string;
}

/** How one collection read went. `truncated` means a cursor was left unfollowed. */
export interface PageReport {
  pages: number;
  rows: number;
  truncated: boolean;
}

/**
 * One request's stream positions, for the ordering and causality claims.
 *
 * Per request, because `itemIndex` is an index within one request's stream.
 * Comparing positions across requests is meaningless, so the two causality
 * positions live here rather than as one pair on the account.
 */
export interface OrderRun {
  runId: string;
  /** `itemIndex` of every top-level item, in the order the stream returned them. */
  indices: number[];
  /** Top-level items carrying no numeric `itemIndex`. Non-zero means no evidence. */
  unreadable: number;
  /** Where this run first changed a file. Null when it mutated nothing readable. */
  firstMutationAt: number | null;
  /**
   * Where this run LAST changed a file — the position assertion 4 grades.
   *
   * The FIRST is not enough: `write@1, report@2, write@3` has activity preceding
   * a report, and a report describing none of the work after it. Comparing the
   * last rejects that world too.
   *
   * Mutations rather than all tool calls, deliberately. A `Read` after the
   * closing word changes nothing, so the report is not wrong about it; a WRITE
   * after the closing word leaves a row in the record the report never covered,
   * which is the case worth failing on.
   */
  lastMutationAt: number | null;
  /** Where this run last said something. Null when it carries no readable message. */
  lastMessageAt: number | null;
}

/** How the plan half resolved for ONE run. */
export interface PlannedRun {
  runId: string;
  /** ROWS: measured. UNMEASURED: the run never planned. LOST: it planned and we dropped it. */
  arm: "ROWS" | "UNMEASURED" | "LOST";
  rows: number;
  toolCalls: number;
}

/**
 * What the plan half OBSERVED — per run, with no overall arm.
 *
 * There is deliberately no pooled verdict here. Combining the arms is a
 * judgement ("does one run's loss outweigh another's success?"), and judgement
 * belongs to the grader; the reader's job is to observe each run separately so
 * nothing can be hidden by pooling. Keeping the combination here also put it
 * where the guard cases — which feed the grader synthetic accounts — could not
 * reach it, so a regression to pooled rows ran green.
 */
export interface PlannedHalf {
  rows: PlanEntry[];
  /** Every run's own arm. The grader combines them. */
  perRun: PlannedRun[];
}

/** Everything the state says about the run, before anything is compared to it. */
export interface Account {
  runIds: string[];
  did: DidEntry[];
  gaps: GapEntry[];
  said: SaidEntry[];
  planned: PlannedHalf;
  /**
   * Shell activity. `succeeded` is the load-bearing one — only a shell call the
   * harness actually ran could have edited a file the recorder cannot see.
   */
  shell: { called: boolean; calls: number; succeeded: number };
  streamMutations: StreamMutation[];
  order: { runs: OrderRun[] };
  /** Every tool name the stream shows, sorted. Reported so a stale name table is visible. */
  toolNamesSeen: string[];
  counts: {
    requests: number;
    items: number;
    topLevel: number;
    messages: number;
    toolOutputs: number;
    fileRows: number;
    planRows: number;
    gapRows: number;
    streamMutations: number;
    /** Mutations the stream shows whose call carried no path to key them under. */
    mutationsWithNoPath: number;
    planToolCalls: number;
  };
  /**
   * Pathless mutations per run. The pooled count cannot be graded: the gap that
   * excuses a skip belongs to the run that skipped, and a total says nothing
   * about which run owes which evidence.
   */
  mutationsWithNoPathByRun: Record<string, number>;
  /** Per collection: pages followed, rows read, and whether a cursor was left. */
  reads: Record<string, PageReport>;
}

/**
 * A safety bound on the cursor loop, and the ONLY way `truncated` becomes true.
 *
 * Not defensive decoration: without a bound, a route that returns a cursor
 * forever hangs the goal instead of failing it, and with the bound the
 * `truncated` flag is a real, reachable state that assertion 7 grades.
 */
const MAX_PAGES = 200;

/** Read every page of one collection for one run, following the cursor. */
async function readCollection(
  read: Read,
  workstreamId: string,
  collection: string,
  runId: string,
): Promise<{ rows: NonNullable<CollectionPage["items"]>; report: PageReport }> {
  const rows: NonNullable<CollectionPage["items"]> = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const query = new URLSearchParams({ topicPrefix: namespaceFor(collection, runId) });
    if (cursor !== undefined) query.set("cursor", cursor);
    const page = (await read(
      `/sessions/${workstreamId}/resources/${collection}?${query.toString()}`,
    )) as CollectionPage;
    pages += 1;
    rows.push(...(page.items ?? []));
    if (page.nextCursor === undefined) {
      return { rows, report: { pages, rows: rows.length, truncated: false } };
    }
    cursor = page.nextCursor;
    if (pages >= MAX_PAGES) {
      return { rows, report: { pages, rows: rows.length, truncated: true } };
    }
  }
}

/** The projected payload. Absent means the field was not exposed, not that it is false. */
function payload(row: { clientData?: Record<string, unknown> }): Record<string, unknown> {
  return row.clientData ?? {};
}

/** Read one projected field as a string, or null when it is absent or not one. */
function str(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === "string" ? value : null;
}

/** The `file_path` a tool call named, from its JSON argument string. */
function pathOfCall(item: StoredItem): string | null {
  const raw = item.toolCall?.arguments;
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = (parsed as Record<string, unknown>).file_path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The text of a message item, joined across its content blocks. */
function textOf(item: StoredItem): string {
  return (item.content ?? [])
    .map((c) => c.text ?? "")
    .filter((t) => t.length > 0)
    .join("\n");
}

/**
 * Derive an account of what a workstream's runs did, from state alone.
 *
 * `read` is the only input besides the workstream's own id. Every collection
 * read is scoped to one run's namespace and paged to exhaustion, so a
 * workstream reused across runs answers per run rather than returning whatever
 * fifty rows sort first.
 */
export async function readAccount(read: Read, workstreamId: string): Promise<Account> {
  const listing = (await read(`/sessions/${workstreamId}/requests?include_items=true`)) as {
    requests?: StoredRequest[];
  };
  const requests = listing?.requests ?? [];
  const runIds = requests.map((r) => r.id).filter((id): id is string => typeof id === "string");

  const allItems = requests.flatMap((r) => r.items ?? []);
  const topLevel = requests.flatMap((r) =>
    (r.items ?? []).filter((i) => i.ownedBy === undefined || i.ownedBy === null),
  );
  const toolItems = allItems.filter((i) => i.type === "tool_output");

  // Activity: every item, sub-agents included — see the header. Walked per
  // request so each mutation keeps the run that made it.
  const mutationTools = new Set<string>(Object.keys(FILE_MUTATION_TOOLS));
  const streamMutations: StreamMutation[] = [];
  const mutationsWithNoPathByRun: Record<string, number> = {};
  let mutationsWithNoPath = 0;
  for (const request of requests) {
    const requestRunId = request.id;
    if (typeof requestRunId !== "string") continue;
    for (const item of (request.items ?? []).filter(
      (i) => i.type === "tool_output" && mutationTools.has(i.toolCall?.name ?? ""),
    )) {
      const path = pathOfCall(item);
      if (path === null) {
        mutationsWithNoPath += 1;
        mutationsWithNoPathByRun[requestRunId] = (mutationsWithNoPathByRun[requestRunId] ?? 0) + 1;
        continue;
      }
      const tool = item.toolCall?.name ?? "";
      const status = typeof item.status === "string" ? item.status : null;
      streamMutations.push({
        runId: requestRunId,
        path,
        tool,
        at: typeof item.itemIndex === "number" ? item.itemIndex : null,
        status,
        kind: FILE_MUTATION_TOOLS[tool],
        outcome: status === null ? null : (OUTCOME_OF_STATUS[status] ?? null),
      });
    }
  }

  // A shell call the harness REFUSED cannot have edited anything, so it must
  // not soften a missing path into "unmeasured" — that would turn a lost write
  // into an inconclusive, which is the exact direction this whole check exists
  // to prevent. Measured on a real run: the agent reached for `Bash`, was
  // refused, and said so. `completed` is required rather than "not failed":
  // a status we cannot read is not evidence that the call succeeded.
  const shellItems = toolItems.filter((i) => i.toolCall?.name === SHELL_TOOL);
  const shellSucceeded = shellItems.filter((i) => i.status === "completed").length;
  const planToolNames = new Set<string>(PLAN_TOOLS);
  const planToolCalls = toolItems.filter((i) => planToolNames.has(i.toolCall?.name ?? "")).length;

  // Narrative and order: the run's own top-level thread.
  const messages = topLevel.filter((i) => i.type === "message");
  const topLevelTools = topLevel.filter((i) => i.type === "tool_output");
  const said: SaidEntry[] = messages.map((i) => ({
    at: typeof i.itemIndex === "number" ? i.itemIndex : null,
    text: textOf(i),
  }));
  const positionsOf = (items: StoredItem[], type: string): number[] =>
    items
      .filter((i) => i.type === type)
      .map((i) => i.itemIndex)
      .filter((v): v is number => typeof v === "number");
  const order: OrderRun[] = requests
    .filter((r) => typeof r.id === "string")
    .map((r) => {
      const own = (r.items ?? []).filter((i) => i.ownedBy === undefined || i.ownedBy === null);
      const indices = own
        .map((i) => i.itemIndex)
        .filter((v): v is number => typeof v === "number");
      // Mutations span EVERY item of the request, sub-agents included: a write a
      // sub-agent makes after the run's closing word is still work the report
      // does not cover. The report is the run's own thread, so top-level only.
      const mutationPositions = (r.items ?? [])
        .filter((i) => i.type === "tool_output" && mutationTools.has(i.toolCall?.name ?? ""))
        .map((i) => i.itemIndex)
        .filter((v): v is number => typeof v === "number");
      const messagePositions = positionsOf(own, "message");
      return {
        runId: r.id as string,
        indices,
        unreadable: own.length - indices.length,
        firstMutationAt: mutationPositions.length > 0 ? Math.min(...mutationPositions) : null,
        lastMutationAt: mutationPositions.length > 0 ? Math.max(...mutationPositions) : null,
        lastMessageAt: messagePositions.length > 0 ? Math.max(...messagePositions) : null,
      };
    });

  // The three records, per run, scoped and paged.
  const did: DidEntry[] = [];
  const gaps: GapEntry[] = [];
  const planRows: PlanEntry[] = [];
  const reads: Record<string, PageReport> = {};
  const merge = (collection: string, report: PageReport): void => {
    const prior = reads[collection];
    reads[collection] =
      prior === undefined
        ? report
        : {
            pages: prior.pages + report.pages,
            rows: prior.rows + report.rows,
            truncated: prior.truncated || report.truncated,
          };
  };

  for (const runId of runIds) {
    const files = await readCollection(read, workstreamId, OBSERVED_FILE_OPS, runId);
    merge(OBSERVED_FILE_OPS, files.report);
    for (const row of files.rows) {
      const data = payload(row);
      const topic = row.topic ?? "";
      // Exactly one naming mutation, or none of its details are derived. Two
      // candidates is an ambiguity the grader reports, never a choice made here.
      const naming = streamMutations.filter(
        (m) => m.runId === runId && sameFile(m.path, topic),
      );
      const unique = naming.length === 1 ? naming[0] : undefined;
      did.push({
        runId,
        topic,
        path: unique?.path ?? null,
        kind: str(data, "lastKind"),
        outcome: str(data, "outcome"),
        firstAt: typeof unique?.at === "number" ? unique.at : null,
        namedBy: naming.length,
      });
    }

    const gapPage = await readCollection(read, workstreamId, OBSERVED_GAPS, runId);
    merge(OBSERVED_GAPS, gapPage.report);
    for (const row of gapPage.rows) {
      const data = payload(row);
      gaps.push({ runId, reason: str(data, "reason"), rawPath: str(data, "rawPath") });
    }

    const planPage = await readCollection(read, workstreamId, OBSERVED_PLAN, runId);
    merge(OBSERVED_PLAN, planPage.report);
    for (const row of planPage.rows) {
      const data = payload(row);
      planRows.push({
        runId,
        title: str(data, "title"),
        status: str(data, "status"),
        previousStatus: str(data, "previousStatus"),
      });
    }
  }

  // Ordered by the first stream position naming the path. A row the stream
  // never named sorts last and is graded by assertion 2, not hidden here.
  did.sort((a, b) => (a.firstAt ?? Number.MAX_SAFE_INTEGER) - (b.firstAt ?? Number.MAX_SAFE_INTEGER));

  const toolNamesSeen = [...new Set(toolItems.map((i) => i.toolCall?.name ?? "(unnamed)"))].sort();

  // The three plan arms, resolved PER RUN. Two of them are empty and need
  // opposite verdicts, and the run's own item stream is what tells them apart.
  const perRunPlan: PlannedRun[] = requests
    .filter((r) => typeof r.id === "string")
    .map((r) => {
      const runId = r.id as string;
      const rows = planRows.filter((row) => row.runId === runId).length;
      const toolCalls = (r.items ?? []).filter(
        (i) => i.type === "tool_output" && planToolNames.has(i.toolCall?.name ?? ""),
      ).length;
      const arm = rows > 0 ? "ROWS" : toolCalls === 0 ? "UNMEASURED" : "LOST";
      return { runId, arm: arm as PlannedRun["arm"], rows, toolCalls };
    });

  const planned: PlannedHalf = { rows: planRows, perRun: perRunPlan };

  return {
    runIds,
    did,
    gaps,
    said,
    planned,
    shell: { called: shellItems.length > 0, calls: shellItems.length, succeeded: shellSucceeded },
    streamMutations,
    order: { runs: order },
    toolNamesSeen,
    counts: {
      requests: requests.length,
      items: allItems.length,
      topLevel: topLevel.length,
      messages: messages.length,
      toolOutputs: topLevelTools.length,
      fileRows: did.length,
      planRows: planRows.length,
      gapRows: gaps.length,
      streamMutations: streamMutations.length,
      mutationsWithNoPath,
      planToolCalls,
    },
    mutationsWithNoPathByRun,
    reads,
  };
}
