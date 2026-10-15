/**
 * The Error Reporter (FIX-1983): what a Lab creates once, hands the engine as
 * its `errorCapture` handler, and binds to its runtime. Workforce never
 * imports the engine, so {@link ErrorReporter.bind} takes the runtime
 * operations; one process binds one reporter. A final event and an errored
 * task ending are what it takes; dedupe, the cap, the preview and filing are
 * the flow's.
 *
 * ```ts
 * const reporter = createErrorReporter({ worker: "error-reporter", operator, tracker: { project: "shared/storefront" } });
 * const flow = defineErrorReporterFlow({ reporter, installation, harness });
 * const intake = defineErrorReporterIntakeFlow({ reporter });
 * const flowState = createFlowState({ flows: { ..., [flow.kind]: flow, [intake.kind]: intake }, errorCapture: reporter.capture });
 * await reporter.bind(host);
 * ```
 */
import { PROJECT_STATE_KEY, WORKER_ID_STATE_KEY, TASK_ID_STATE_KEY } from "../workers/keys";
import { COMMENT_ENTRY, LINE_ENTRY, REPORT_ENTRY, REPORTS_ENTRY, REPORT_SESSION_PREFIX } from "./flow";
import { ERROR_REPORTER_FLOW, ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY, INTAKE_SESSION_ID } from "./keys";
import type { IntakeDecision, Occurrence, OccurrenceIds, ReportLimits, ReportRow } from "./reports";

export { INTAKE_SESSION_ID };

/**
 * A final failure, as the engine's `errorCapture` hands it: only the fields the
 * reporter reads. An event without `final` is a block's error on the way, and
 * is never reported.
 */
export interface FinalFailureEvent {
  readonly error: { readonly message: string; readonly code?: string };
  readonly requestId: string;
  readonly flowKind: string;
  readonly actionName: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly orgId?: string;
  readonly blockName?: string;
  readonly blockPath?: string;
  readonly final?: true;
}

/** Who a report waits on and files as: the Lab's operator. */
export interface ErrorReporterOperator {
  readonly userId: string;
  readonly orgId: string;
}

/** What a session holds, as the host reads it for a dossier. */
export interface ReporterSessionFacts {
  readonly id: string;
  readonly flowKind?: string;
  readonly userId?: string;
  readonly state?: Readonly<Record<string, unknown>>;
  /** What happened in it, as the host chooses to summarize it (its last items). */
  readonly summary?: unknown;
}

/** The outcome of one run the host started: its output, or why it failed. */
export interface ReporterRunResult {
  readonly output?: unknown;
  readonly error?: string;
}

/** The runtime operations a Lab hands the reporter. */
export interface ErrorReporterHost {
  /** Run an action of a flow as `userId`. `source: "internal"` reaches an internal entry. */
  run(request: {
    readonly flowKind: string;
    readonly action: string;
    readonly input: unknown;
    readonly userId: string;
    readonly orgId: string;
    readonly sessionId: string;
    readonly source: "http" | "internal";
  }): Promise<ReporterRunResult>;
  /** Make sure a session exists, created with `state` when it doesn't. */
  openSession(open: {
    readonly flowKind: string;
    readonly sessionId: string;
    readonly userId: string;
    readonly orgId: string;
    readonly state: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  /** What one session holds, or `undefined` when it doesn't exist. */
  readSession(sessionId: string): Promise<ReporterSessionFacts | undefined>;
  /**
   * Only a session's state, or `undefined`: read for every final failure, to
   * hold a task's failed request for its ending. Without it, `readSession` is used.
   */
  readSessionState?(sessionId: string): Promise<Readonly<Record<string, unknown>> | undefined>;
  /** What one request was: its input, status and error. */
  readRequest?(requestId: string): Promise<unknown>;
  /** A user's newest sessions, for a problem a user reported without naming one. */
  recentSessions?(userId: string, limit: number): Promise<ReporterSessionFacts[]>;
  /** The reporter's conversation, where it says what it filed. */
  readonly conversationSessionId?: string;
}

/** Options for {@link createErrorReporter}. */
export interface ErrorReporterOptions {
  /** The reporter's worker id: the `WORKER.md` its sessions run. */
  readonly worker: string;
  /** Who previews and files. */
  readonly operator: ErrorReporterOperator;
  /** Where reports file: a project whose MCP servers reach the tracker. Absent: reports are kept and not filed. */
  readonly tracker?: {
    /** The project whose MCP servers reach the tracker, as `<visibility>/<id>` (`shared/storefront`). */
    readonly project: string;
    /** A hint for the filing run, such as the tracker's team. */
    readonly hint?: string;
  };
  /** The preview. Every report waits for it unless named here. */
  readonly preview?: {
    /** Error codes, or sources (`request` / `task` / `manual` / `storm`), that file without a preview. Default none. */
    readonly autoFile?: readonly string[];
    /** File as drafted when the preview goes unanswered this long. Default never. */
    readonly autoFileAfterMs?: number;
  };
  /** The intake's limits. */
  readonly limits?: Partial<ReportLimits>;
  /** Report only the failures this returns true for. */
  readonly filter?: (event: FinalFailureEvent) => boolean;
  /** Values no report may hold, beside the environment's keys and the operator's MCP keys. */
  readonly secrets?: () => readonly string[];
  /** Links for an occurrence (a devtool trace, a Shift Manager page), by label. */
  readonly links?: (ids: OccurrenceIds) => Record<string, string>;
  /** Where the reporter says what went wrong with itself. Default `console.warn`. */
  readonly log?: (message: string) => void;
}

/** The reporter: the engine's handler, the host binding, and what its flow reads. */
export interface ErrorReporter {
  readonly worker: string;
  readonly flowKind: string;
  readonly operator: ErrorReporterOperator;
  readonly tracker: ErrorReporterOptions["tracker"];
  readonly preview: ErrorReporterOptions["preview"];
  readonly limits: Partial<ReportLimits> | undefined;
  /** The engine's `errorCapture` handler. Takes `final` events only; never throws. */
  capture(event: FinalFailureEvent): void;
  /** Whether the Lab's `filter` takes this failure. A filter that throws takes nothing. */
  takes(event: FinalFailureEvent): boolean;
  /** Bind the runtime, and restart what the store says is still owed. */
  bind(host: ErrorReporterHost): Promise<void>;
  /** Resolves when every run the reporter started so far has settled. */
  idle(): Promise<void>;
  /** Start nothing more: a host that is closing calls it before its stores close. What is owed stays owed. */
  dispose(): void;
  /** The Lab's own secrets. */
  secrets(): readonly string[];
  /** Start what an intake's decision owes: a report's run, or a counted comment. */
  follow(decision: IntakeDecision): void;
  /** A line in the reporter's conversation. */
  say(text: string): Promise<void>;
  /** The dossier a report is drafted from, gathered by code. */
  dossierOf(row: ReportRow): Promise<Record<string, unknown>>;
}

/** The newest requests and sessions a dossier reads. */
const DOSSIER_REQUESTS = 3;
const RECENT_SESSIONS = 3;

/** How an intake that failed is tried again: the waits between tries. */
const INTAKE_RETRY_MS = [1_000, 5_000, 30_000, 120_000];

/** How long a report or comment that couldn't reach the tracker waits before it is tried again. */
const RUN_RETRY_MS = 5 * 60_000;

/**
 * Create the Error Reporter.
 *
 * @param options Its worker, operator, tracker, preview and limits.
 */
export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const flowKind = ERROR_REPORTER_FLOW;
  const log = options.log ?? ((message: string) => console.warn(`[error-reporter] ${message}`));
  let host: ErrorReporterHost | undefined;
  let disposed = false;
  // Failures that arrive before the bind wait for it.
  const early: FinalFailureEvent[] = [];
  // Intakes run one at a time, in arrival order; report and comment runs on a chain of their own.
  let intakes: Promise<void> = Promise.resolve();
  let runs: Promise<void> = Promise.resolve();
  // Reports started in this process: a report is never started twice at once.
  const started = new Set<string>();

  const operatorRun = (sessionId: string, action: string, input: unknown, source: "http" | "internal", onFlow: string = flowKind) =>
    host!.run({ flowKind: onFlow, action, input, userId: options.operator.userId, orgId: options.operator.orgId, sessionId, source });

  /** Run `work` after `ms`, unless the reporter was disposed by then. Never keeps a process alive. */
  const later = (ms: number, work: () => void) => {
    const timer = setTimeout(() => {
      if (!disposed) work();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };

  const intakeOf = async (event: FinalFailureEvent): Promise<Occurrence> => {
    const fields = {
      at: Date.now(),
      requestId: event.requestId,
      userId: event.userId,
      flowKind: event.flowKind,
      actionName: event.actionName,
      message: event.error.message,
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
      ...(event.orgId !== undefined ? { orgId: event.orgId } : {}),
      ...(event.blockName !== undefined ? { blockName: event.blockName } : {}),
      ...(event.blockPath !== undefined ? { blockPath: event.blockPath } : {}),
      ...(event.error.code !== undefined ? { code: event.error.code } : {})
    };
    // A request in a task's session is held for the task's ending: the task
    // may retry and pass, and only the ending says it stayed failed.
    const state =
      event.sessionId === undefined
        ? undefined
        : host!.readSessionState !== undefined
          ? await host!.readSessionState(event.sessionId).catch(() => undefined)
          : (await host!.readSession(event.sessionId).catch(() => undefined))?.state;
    const taskId = state?.[TASK_ID_STATE_KEY];
    return typeof taskId === "string" ? { kind: "held", taskId, ...fields } : { kind: "request", ...fields };
  };

  // A failed intake is tried again (the intake counts a redelivery once); after the last try it is logged.
  const take = (event: FinalFailureEvent, tries = 0) => {
    intakes = intakes.then(async () => {
      if (disposed) return;
      let failure: string | undefined;
      try {
        const result = await operatorRun(INTAKE_SESSION_ID, INTAKE_ENTRY, { occurrence: await intakeOf(event) }, "internal", ERROR_REPORTER_INTAKE_FLOW);
        failure = result.error;
      } catch (error) {
        failure = String(error);
      }
      if (failure === undefined) return;
      const wait = INTAKE_RETRY_MS[tries];
      if (wait === undefined) log(`couldn't take request ${event.requestId}'s failure after ${tries + 1} tries: ${failure}`);
      else later(wait, () => take(event, tries + 1));
    });
  };

  const onChain = (label: string, work: () => Promise<void>) => {
    runs = runs.then(async () => {
      if (disposed) return;
      try {
        await work();
      } catch (error) {
        log(`${label} failed: ${String(error)}`);
      }
    });
  };

  const reportSession = (reportId: string) => `${REPORT_SESSION_PREFIX}${reportId}`;

  const openReportSession = (reportId: string) =>
    host!.openSession({
      flowKind,
      sessionId: reportSession(reportId),
      userId: options.operator.userId,
      orgId: options.operator.orgId,
      state: { [WORKER_ID_STATE_KEY]: options.worker }
    });

  // A run's row is claimed in the store, so two processes never run one report at once; this only
  // spares a second start from this process.
  const startReport = (reportId: string) => {
    if (host === undefined || started.has(reportId)) return;
    started.add(reportId);
    onChain(`report ${reportId}`, async () => {
      try {
        await openReportSession(reportId);
        const result = await operatorRun(reportSession(reportId), REPORT_ENTRY, {}, "http");
        if (result.error !== undefined) log(`report ${reportId}'s run failed: ${result.error}`);
        // An approved report the tracker didn't take is owed a filing: tried again later, and at the next start.
        if ((result.output as { retry?: unknown } | undefined)?.retry === true) later(RUN_RETRY_MS, () => startReport(reportId));
      } finally {
        started.delete(reportId);
      }
    });
  };

  const startComment = (reportId: string) => {
    if (host === undefined) return;
    onChain(`comment on ${reportId}`, async () => {
      await openReportSession(reportId);
      const result = await operatorRun(reportSession(reportId), COMMENT_ENTRY, {}, "internal");
      if ((result.output as { commented?: unknown; closed?: unknown } | undefined)?.commented === false && (result.output as { closed?: unknown }).closed === false) {
        later(RUN_RETRY_MS, () => startComment(reportId));
      }
    });
  };

  const sessionFacts = async (sessionId: string) => {
    const facts = await host!.readSession(sessionId).catch(() => undefined);
    return facts === undefined ? undefined : { id: facts.id, flowKind: facts.flowKind, state: facts.state, summary: facts.summary, userId: facts.userId };
  };

  const reporter: ErrorReporter = {
    worker: options.worker,
    flowKind,
    operator: options.operator,
    tracker: options.tracker,
    preview: options.preview,
    limits: options.limits,

    takes(event) {
      try {
        return options.filter === undefined || options.filter(event);
      } catch (error) {
        log(`filter threw: ${String(error)}`);
        return false;
      }
    },

    capture(event) {
      if (event.final !== true || event.flowKind === flowKind || event.flowKind === ERROR_REPORTER_INTAKE_FLOW) return;
      if (!reporter.takes(event)) return;
      if (host === undefined) early.push(event);
      else take(event);
    },

    async bind(given) {
      host = given;
      await host.openSession({
        flowKind: ERROR_REPORTER_INTAKE_FLOW,
        sessionId: INTAKE_SESSION_ID,
        userId: options.operator.userId,
        orgId: options.operator.orgId,
        state: {}
      });
      for (const event of early.splice(0)) take(event);
      // The rows are the outbox: what a stopped process left owed runs again.
      const result = await operatorRun(INTAKE_SESSION_ID, REPORTS_ENTRY, { op: "all" }, "internal", ERROR_REPORTER_INTAKE_FLOW);
      const rows = ((result.output as { rows?: ReportRow[] } | undefined)?.rows ?? []) as ReportRow[];
      const now = Date.now();
      for (const row of rows) {
        if (row.status === "owed" || row.status === "drafting" || row.status === "filing") {
          // Another run holds it: try once its claim has lapsed.
          if (row.claim !== undefined && row.claim.until > now) later(row.claim.until - now + 1_000, () => startReport(row.id));
          else startReport(row.id);
        } else if (row.status === "filed" && row.commentOwed === true) startComment(row.id);
      }
    },

    async idle() {
      // A run can start another (an intake's report), so wait until both chains stand still.
      for (;;) {
        const [a, b] = [intakes, runs];
        await Promise.all([a, b]);
        if (a === intakes && b === runs) return;
      }
    },

    dispose() {
      disposed = true;
    },

    secrets: () => options.secrets?.() ?? [],

    follow(decision) {
      if (decision.decision === "new" || (decision.decision === "storm" && decision.isNew)) startReport(decision.reportId);
      else if ((decision.decision === "counted" || decision.decision === "storm") && decision.commentOwed) startComment(decision.reportId);
    },

    async say(text) {
      if (host?.conversationSessionId === undefined) return;
      await operatorRun(host.conversationSessionId, LINE_ENTRY, { text }, "internal");
    },

    async dossierOf(row) {
      const latest = row.occurrences.at(-1);
      const requestIds = [
        ...new Set([...(row.heldRequests ?? []).map((r) => r.requestId), ...row.occurrences.map((o) => o.requestId)].filter((id): id is string => id !== undefined))
      ].slice(-DOSSIER_REQUESTS);
      const requests: unknown[] = [];
      if (host?.readRequest !== undefined) {
        for (const id of requestIds) requests.push(await host.readRequest(id).catch((error) => ({ id, unreadable: String(error) })));
      }
      const sessions: unknown[] = [];
      if (host !== undefined) {
        const reporterOwn = new Set([latest?.sessionId].filter((id) => id !== undefined && row.source === "manual"));
        const ids = [...new Set(row.occurrences.map((o) => o.sessionId).filter((id): id is string => id !== undefined && !reporterOwn.has(id)))].slice(-DOSSIER_REQUESTS);
        for (const id of ids) {
          const facts = await sessionFacts(id);
          if (facts !== undefined) sessions.push(facts);
        }
      }
      // A user's report: what they named, when it is theirs, else their newest sessions.
      let named: unknown;
      if (row.source === "manual" && host !== undefined && row.named !== undefined) {
        // Checked against the user who named it, not whoever reported the same problem last.
        const { by, ...named0 } = row.named;
        const sender = by ?? latest?.userId;
        const session = named0.sessionId === undefined ? undefined : await sessionFacts(named0.sessionId);
        named = {
          ...named0,
          ...(session === undefined
            ? {}
            : session.userId === sender
              ? { session }
              : { session: "not readable: it is not the reporting user's session" })
        };
      } else if (row.source === "manual" && host?.recentSessions !== undefined && latest?.userId !== undefined) {
        const recent = await host.recentSessions(latest.userId, RECENT_SESSIONS + 1).catch((): ReporterSessionFacts[] => []);
        named = {
          recentSessions: recent
            .filter((s) => s.id !== latest.sessionId && !s.id.startsWith(REPORT_SESSION_PREFIX))
            .slice(0, RECENT_SESSIONS)
            .map((s) => ({ id: s.id, flowKind: s.flowKind, state: s.state, summary: s.summary }))
        };
      }
      // The project the failing session is linked to, never the tracker's.
      const failing = sessions.find((s) => (s as ReporterSessionFacts).id === latest?.sessionId) as ReporterSessionFacts | undefined;
      const project = failing?.state?.[PROJECT_STATE_KEY];
      return {
        report: {
          id: row.id,
          source: row.source,
          count: row.count,
          firstSeenAt: new Date(row.firstSeenAt).toISOString(),
          lastSeenAt: new Date(row.lastSeenAt).toISOString(),
          failure: row.parts,
          ...(row.description === undefined ? {} : { description: row.description }),
          ...(row.task === undefined ? {} : { task: row.task }),
          ...(row.storm === undefined ? {} : { storm: row.storm.entries })
        },
        occurrences: row.occurrences,
        ...(row.heldRequests === undefined ? {} : { heldRequests: row.heldRequests }),
        ...(requests.length === 0 ? {} : { requests }),
        ...(sessions.length === 0 ? {} : { sessions }),
        ...(named === undefined ? {} : { named }),
        ...(typeof project === "string" ? { project } : {}),
        ...(latest !== undefined && options.links !== undefined ? { links: options.links(latest) } : {})
      };
    }
  };
  return reporter;
}
