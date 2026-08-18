/**
 * The deprived reader: FSD state in, an account of the run out.
 *
 * Its ONLY input is `read` — a bound reader for one host's HTTP routes. It has
 * no filesystem, no process, no git, and no way to reach the harness
 * transcript, because it has no way to reach anything it was not handed. That
 * is a parameter shape, not a promise: `run.mts` asserts the deprivation
 * mechanically over this file's own source and over `paths.mts`.
 *
 * `goal.md` is the contract. This header carries the invariants a reader of the
 * CODE needs and does not restate it.
 *
 * ## The account is a LIST OF PER-RUN VIEWS, and that is structural
 *
 * A workstream is reused, so an account spanning runs is an account with two
 * scopes in it — and every per-run judgement that could reach a pooled value
 * became a defect. Five of them, found across three separate reviews: a gap
 * consumed twice, a pathless skip answered by any gap anywhere, the plan arm
 * pooled, the shell exemption pooled, the plan status check pooled. Each was
 * fixed by adding a `runId ===` filter, and the next review found another.
 *
 * So the pooled shape is gone. Everything an assertion about one run could want
 * lives on that run's {@link RunView}, and the grader's per-run half is handed
 * a view rather than the account. A pooled read is not filtered out — it is
 * unreachable, because the function holding the judgement never receives the
 * other runs. Only paging and the request count are account-level, and neither
 * is a per-run claim.
 *
 * ## Which items feed which derivation, and why they differ
 *
 * - **Activity** — file mutations, shell calls, plan-tool calls — is scanned
 *   over EVERY item of the request, sub-agents included. A sub-agent's items
 *   nest under `ownedBy` and the recorder does not filter on that, so a
 *   top-level-only scan would see a collection row whose mutation "is missing
 *   from the stream" and report the graph as having invented a write.
 * - **Narrative and order** are top-level only: the run's own thread.
 *
 * ## Two field traps, both measured
 *
 * - The ordering key is `itemIndex`. `seq` does not exist on a persisted item,
 *   and reading it yields an empty set every `every()` passes vacuously.
 * - A row's payload is on `clientData`, not `state`, and `clientData` is a
 *   PROJECTION: a field the collection does not expose reads `undefined` after
 *   a valid 200. Absence is reported as absence, never as a value.
 *
 * A tool result's `output` is the prose shown to the model. Nothing here parses
 * it; paths come from `toolCall.arguments`, a JSON string of the real input.
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
 * `packages/claude-code/src/sdk/translate.ts`). Not imported because the
 * recorder does not export it, and exporting it to satisfy a check would widen
 * the package's public surface for a test. If the two disagree, A2 goes red in
 * both directions at once.
 *
 * The mapping — not just the names — is translated here so that no ASSERTION
 * ever knows a tool name: the grader compares `mutation.kind` against the row's
 * `kind` without knowing what either tool means.
 *
 * **`Write` maps to null because the tool name does not determine the kind.**
 * A `Write` over an existing file is an edit, and the recorder knows that: it
 * prefers the harness's reported `type` (`create`/`update`) and falls back to
 * the tool only when none is reported. The item stream carries no such field,
 * so the stream simply makes no claim about a `Write`'s kind — and asserting
 * one would fail faithful state while passing a recorder that mislabels an
 * overwrite. `Edit` is unambiguous in both directions and keeps its teeth.
 */
export const FILE_MUTATION_TOOLS: Record<string, string | null> = { Write: null, Edit: "edited" };

/**
 * How a settled tool result maps to the outcome a row should carry. Framework
 * vocabulary on both sides; a status we do not list yields NO expectation, and
 * the grader fails on that rather than skipping the comparison.
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

/**
 * The create half, named because a FAILED create records nothing by design —
 * nothing was created, so there is no row to lose. Counting it as a call that
 * should have produced one turns a faithful, fully visible failure into a
 * reported recorder loss.
 */
const PLAN_CREATE_TOOL = "TaskCreate";

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
  /** The path exactly as the tool call named it — raw, uncanonicalized. */
  path: string;
  tool: string;
  at: number | null;
  /** `completed` / `failed` as the item recorded it. Never parsed from prose. */
  status: string | null;
  /**
   * What the record SHOULD say this was, or **null when the tool name does not
   * determine it** — a `Write` over an existing file is an edit. The stream
   * makes no claim in that case, and the grader compares nothing rather than
   * inventing one.
   */
  kind: string | null;
  /**
   * What the record SHOULD say about how it ended. **Null means the item's
   * status was not one we can translate**, so nothing is claimed — and the
   * grader FAILS on that rather than skipping the comparison. A row asserting
   * `applied` beside a mutation whose ending is unreadable is a claim nothing
   * corroborates, which is this epic's exact failure shape.
   */
  outcome: string | null;
}

/** One path the file-op collection says the run touched. */
export interface DidEntry {
  /**
   * The row's own key, verbatim and unparsed — the row's IDENTITY. Every
   * comparison runs against it by trailing path segments, which is what makes
   * the check indifferent to how many namespace segments precede the path.
   */
  topic: string;
  /**
   * The path as the run's tool call spelled it, from the matching stream
   * mutation. Null unless exactly one named it.
   */
  path: string | null;
  /** `created` / `edited`, or null when the projection does not carry it. */
  kind: string | null;
  /** `pending` / `applied` / `failed`, or null when not carried. */
  outcome: string | null;
  /** First `itemIndex` naming this row; null unless exactly one mutation did. */
  firstAt: number | null;
  /**
   * How many of this run's stream mutations name this row. Anything but 1 is
   * unresolvable and is graded, never silently picked — see `paths.mts`.
   */
  namedBy: number;
}

/** One thing the recorder recognised and could not record. */
export interface GapEntry {
  /**
   * WHICH record this gap stands in for — `file` / `plan` / `run`, a closed set
   * on the row itself. It is what lets an exemption say which skip it is
   * standing in for instead of counting rows and hoping; a pathless gap carries
   * no `rawPath` to infer it from, and recovering it from `reason` would be the
   * substring grading this check refuses. Null when the row predates the field
   * or it was projected away — and a gap that cannot name its subject is not
   * evidence for a specific skip.
   */
  kind: string | null;
  reason: string | null;
  rawPath: string | null;
}

/** One item on the run's own to-do list. */
export interface PlanEntry {
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

/** One run's stream positions, for the ordering and causality claims. */
export interface OrderRun {
  /** `itemIndex` of every top-level item, in the order the stream returned them. */
  indices: number[];
  /** Top-level items carrying no numeric `itemIndex`. Non-zero means no evidence. */
  unreadable: number;
  /** Where this run first changed a file. */
  firstMutationAt: number | null;
  /**
   * Where this run LAST changed a file — the position assertion 4 grades.
   *
   * The FIRST is not enough: `write@1, report@2, write@3` has activity preceding
   * a report and a report describing none of the work after it. Mutations rather
   * than all tool calls: a `Read` after the closing word changes nothing.
   */
  lastMutationAt: number | null;
  /** Where this run last said something. */
  lastMessageAt: number | null;
  /**
   * Mutations whose position could not be read. Dropping them silently would
   * compute `lastMutationAt` from a subset and certify an order over a set
   * smaller than the one being described — and a sub-agent's mutation is not
   * top-level, so `unreadable` above does not cover it.
   */
  unreadableMutationPositions: number;
}

/**
 * Everything the state says about ONE run.
 *
 * This is the unit every per-run assertion is handed. It exists so that a
 * judgement about this run cannot reach another run's evidence — not by
 * filtering, but because the other runs are not in scope.
 */
export interface RunView {
  runId: string;
  did: DidEntry[];
  gaps: GapEntry[];
  streamMutations: StreamMutation[];
  said: SaidEntry[];
  /** Observed, not judged: the grader decides which arm these imply. */
  plan: { rows: PlanEntry[]; toolCalls: number };
  order: OrderRun;
  /** `succeeded` is the load-bearing one: a refused call changed nothing. */
  shell: { called: boolean; calls: number; succeeded: number };
  /** Mutations whose call carried no path to key them under. */
  mutationsWithNoPath: number;
  /**
   * Top-level `message` items carrying no readable text.
   *
   * They are NOT in `said`: an entry whose text is empty inflates the count A6
   * reads and lends A4 a position, while the account can report nothing the run
   * said at that point. Counting them separately keeps the set honest and lets
   * the absence be graded — without reading the prose, which the anti-game
   * forbids. Only presence is inspected here, never content.
   */
  messagesWithoutText: number;
  /** Every tool name this run's stream shows, sorted. */
  toolNamesSeen: string[];
  counts: {
    items: number;
    topLevel: number;
    messages: number;
    toolOutputs: number;
  };
  /** Per collection, for this run's namespace: pages followed and rows read. */
  reads: Record<string, PageReport>;
}

/** The state's answer to "what happened in this workstream", partitioned by run. */
export interface Account {
  runs: RunView[];
  /**
   * Account-level, and not a per-run claim.
   *
   * `requests` counts what the route returned; `runs.length` counts what could
   * be turned into a view. They differ when a request carries no readable id,
   * and the grader fails on the difference rather than grading what survived —
   * a request dropped by control flow is an absence no assertion downstream can
   * see, which is the same family as a null that skips a comparison.
   */
  counts: { requests: number };
}

/**
 * A safety bound on the cursor loop, and the ONLY way `truncated` becomes true.
 *
 * Not defensive decoration: without a bound, a route returning a cursor forever
 * hangs the goal instead of failing it, and with it `truncated` is a real,
 * reachable state that assertion 7 grades.
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

/** The projected payload. Absent means the field was not exposed. */
function payload(row: { clientData?: Record<string, unknown> }): Record<string, unknown> {
  return row.clientData ?? {};
}

/** Read one projected field as a string, or null when absent or not one. */
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
 * read is scoped to one run's namespace and paged to exhaustion, and every
 * derivation lands on that run's view.
 */
export async function readAccount(read: Read, workstreamId: string): Promise<Account> {
  const listing = (await read(`/sessions/${workstreamId}/requests?include_items=true`)) as {
    requests?: StoredRequest[];
  };
  const requests = listing?.requests ?? [];
  const mutationTools = new Set<string>(Object.keys(FILE_MUTATION_TOOLS));
  const planToolNames = new Set<string>(PLAN_TOOLS);

  const runs: RunView[] = [];
  for (const request of requests) {
    const runId = request.id;
    if (typeof runId !== "string") continue;

    const items = request.items ?? [];
    const topLevel = items.filter((i) => i.ownedBy === undefined || i.ownedBy === null);
    const toolItems = items.filter((i) => i.type === "tool_output");

    // Activity: every item of this request, sub-agents included.
    const streamMutations: StreamMutation[] = [];
    let mutationsWithNoPath = 0;
    let unreadableMutationPositions = 0;
    const mutationPositions: number[] = [];
    for (const item of toolItems.filter((i) => mutationTools.has(i.toolCall?.name ?? ""))) {
      // The POSITION is captured before the path is, deliberately. A mutation
      // the recorder could not key still happened, and still happened at a
      // point in the stream — dropping it here would let a pathless write land
      // after the closing report while A4 compared only the writes that had a
      // path and reported that nothing followed it.
      if (typeof item.itemIndex === "number") mutationPositions.push(item.itemIndex);
      else unreadableMutationPositions += 1;
      const path = pathOfCall(item);
      if (path === null) {
        mutationsWithNoPath += 1;
        continue;
      }
      const tool = item.toolCall?.name ?? "";
      const status = typeof item.status === "string" ? item.status : null;
      streamMutations.push({
        path,
        tool,
        at: typeof item.itemIndex === "number" ? item.itemIndex : null,
        status,
        kind: FILE_MUTATION_TOOLS[tool],
        outcome: status === null ? null : (OUTCOME_OF_STATUS[status] ?? null),
      });
    }

    const shellItems = toolItems.filter((i) => i.toolCall?.name === SHELL_TOOL);
    // A shell call the harness REFUSED cannot have edited anything, so it must
    // not soften a missing path into "unmeasured". `completed` is required
    // rather than "not failed": a status we cannot read is not evidence that
    // the call succeeded. Measured on a real run — the agent reached for
    // `Bash`, was refused, and said so.
    const shellSucceeded = shellItems.filter((i) => i.status === "completed").length;
    // A failed create is excluded: the translator records nothing for it
    // because nothing was created, so it is a visible failure rather than a
    // lost row. A failed UPDATE still records, so it stays counted.
    const planToolCalls = toolItems.filter(
      (i) =>
        planToolNames.has(i.toolCall?.name ?? "") &&
        !(i.toolCall?.name === PLAN_CREATE_TOOL && i.status === "failed"),
    ).length;

    // Narrative and order: this run's own top-level thread.
    const messages = topLevel.filter((i) => i.type === "message");
    const topLevelTools = topLevel.filter((i) => i.type === "tool_output");
    const spoken = messages
      .map((i) => ({ at: typeof i.itemIndex === "number" ? i.itemIndex : null, text: textOf(i) }))
      .filter((m) => m.text.length > 0);
    const said: SaidEntry[] = spoken;
    const messagesWithoutText = messages.length - spoken.length;
    const indices = topLevel
      .map((i) => i.itemIndex)
      .filter((v): v is number => typeof v === "number");
    // Positions come from the messages that actually said something, so A4
    // cannot place the report at a point where the account is silent.
    const messagePositions = spoken
      .map((m) => m.at)
      .filter((v): v is number => typeof v === "number");

    // The three records, for THIS run's namespace, scoped and paged.
    const reads: Record<string, PageReport> = {};
    const files = await readCollection(read, workstreamId, OBSERVED_FILE_OPS, runId);
    reads[OBSERVED_FILE_OPS] = files.report;
    const did: DidEntry[] = files.rows.map((row) => {
      const data = payload(row);
      const topic = row.topic ?? "";
      // Exactly one naming mutation, or none of its details are derived. Two
      // candidates is an ambiguity the grader reports, never a choice made here.
      const naming = streamMutations.filter((m) => sameFile(m.path, topic));
      const unique = naming.length === 1 ? naming[0] : undefined;
      return {
        topic,
        path: unique?.path ?? null,
        kind: str(data, "lastKind"),
        outcome: str(data, "outcome"),
        firstAt: typeof unique?.at === "number" ? unique.at : null,
        namedBy: naming.length,
      };
    });
    // Ordered by the first stream position naming the row. A row the stream
    // never named sorts last and is graded by A2, not hidden here.
    did.sort(
      (a, b) => (a.firstAt ?? Number.MAX_SAFE_INTEGER) - (b.firstAt ?? Number.MAX_SAFE_INTEGER),
    );

    const gapPage = await readCollection(read, workstreamId, OBSERVED_GAPS, runId);
    reads[OBSERVED_GAPS] = gapPage.report;
    const gaps: GapEntry[] = gapPage.rows.map((row) => {
      const data = payload(row);
      return {
        kind: str(data, "kind"),
        reason: str(data, "reason"),
        rawPath: str(data, "rawPath"),
      };
    });

    const planPage = await readCollection(read, workstreamId, OBSERVED_PLAN, runId);
    reads[OBSERVED_PLAN] = planPage.report;
    const planRows: PlanEntry[] = planPage.rows.map((row) => {
      const data = payload(row);
      return {
        title: str(data, "title"),
        status: str(data, "status"),
        previousStatus: str(data, "previousStatus"),
      };
    });

    runs.push({
      runId,
      did,
      gaps,
      streamMutations,
      said,
      plan: { rows: planRows, toolCalls: planToolCalls },
      order: {
        indices,
        unreadable: topLevel.length - indices.length,
        firstMutationAt: mutationPositions.length > 0 ? Math.min(...mutationPositions) : null,
        lastMutationAt: mutationPositions.length > 0 ? Math.max(...mutationPositions) : null,
        lastMessageAt: messagePositions.length > 0 ? Math.max(...messagePositions) : null,
        unreadableMutationPositions,
      },
      shell: {
        called: shellItems.length > 0,
        calls: shellItems.length,
        succeeded: shellSucceeded,
      },
      mutationsWithNoPath,
      messagesWithoutText,
      toolNamesSeen: [...new Set(toolItems.map((i) => i.toolCall?.name ?? "(unnamed)"))].sort(),
      counts: {
        items: items.length,
        topLevel: topLevel.length,
        messages: messages.length,
        toolOutputs: topLevelTools.length,
      },
      reads,
    });
  }

  return { runs, counts: { requests: requests.length } };
}
