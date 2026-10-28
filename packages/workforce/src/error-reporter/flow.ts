/**
 * The Error Reporter's flow (FIX-1983): drafts a bug report, asks the operator
 * in Inbox, and files it once they answer. It runs on its own flow, never
 * through the Shift Coordinator, which is the part most likely to have failed.
 */
import { defineFlow, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { BlockContext, HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { agentWorkerTurn, type AgentWorkerFlowOptions } from "../agent-worker-flow";
import type { ProjectMcpToolsResolver, RelayedMcpServer } from "../projects/project-mcp-tools";
import { MCP_CREDENTIALS_RESOURCE } from "../projects/mcp-credentials";
import { readStandingRules } from "../standing-rules/rules-record";
import { renderRules } from "../standing-rules/rules-list";
import { STANDING_RULES_ACTION, standingRulesAction } from "../standing-rules/rules-action";
import { defineSetWorkProjectBlock, setWorkProjectInputSchema } from "../projects/work-project";
import { markUserTurnStep } from "../standing-rules/user-turn";
import { turnConfigOf } from "../workers/verified-worker";
import type { WorkerInstallation } from "../workers/installation";
import { MESSAGE_RECEIVED_ENTRY } from "../messages/keys";
import { workerMessagesResources } from "../messages/message-log";
import { messageReceivedEntry, promptedMessageTurn } from "../messages/message-received-entry";
import { PROJECT_STATE_KEY, SET_WORK_PROJECT_ACTION } from "../workers/keys";
import { defineMcpCredentialsCollection } from "../projects/mcp-credentials";
import { conversationLedgerAt, conversationLedgerResources } from "../conversation-board/ledger";
import { reportOwedKey } from "../conversation-board/report-owed";
import { ERROR_REPORTER_FLOW, ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY } from "./keys";
import { redact, secretsFromEnv } from "./redact";
import {
  CLAIM_LEASE_MS,
  errorReportsResources,
  intakeOccurrence,
  listReports,
  occurrenceSchema,
  readReport,
  reportsOf,
  updateReport,
  type IntakeDecision,
  type Occurrence,
  type ReportRow
} from "./reports";
import type { ErrorReporter, FinalFailureEvent } from "./reporter";
import { RESPOND_ACTION } from "../worker-door";

export { ERROR_REPORTER_FLOW, ERROR_REPORTER_INTAKE_FLOW };

/** The entries, by name. */
export const REPORT_ENTRY = "report";
export const COMMENT_ENTRY = "comment";
export const REPORTS_ENTRY = "reports";
export const LINE_ENTRY = "line";

/** A report's session: one per report row, its id the row's key behind this prefix. */
export const REPORT_SESSION_PREFIX = "error-report~";

/** The report a report session is for, read off the session's own id. */
function reportIdOfSession(sessionId: string): string | undefined {
  return sessionId.startsWith(REPORT_SESSION_PREFIX) ? sessionId.slice(REPORT_SESSION_PREFIX.length) : undefined;
}

/** What the harness is handed per run, as a coding harness is. */
export interface ErrorReporterHarnessFeeds {
  /** Where the run reads the code. */
  cwd: (ctx: HarnessCallbackContext) => string | Promise<string>;
  /**
   * The project's MCP servers, every call's arguments redacted. Handed only to
   * the harness that files and comments, after the operator approved; the one
   * that drafts gets none.
   */
  mcpTools?: ProjectMcpToolsResolver;
}

/** Options for {@link defineErrorReporterFlow}. */
export interface ErrorReporterFlowOptions {
  /** The reporter this flow serves: its worker, operator, tracker, limits and preview. */
  reporter: ErrorReporter;
  /** The worker installation the reporter's `WORKER.md` is a standard worker of. */
  installation: WorkerInstallation;
  /** Build the harness from its feeds. Claude Code in a Lab; read-only tools are enough to draft. */
  harness: (feeds: ErrorReporterHarnessFeeds) => HarnessBlock;
  /** Where the harness reads the code: a directory, or one per run. Default `process.cwd()`. */
  cwd?: string | ((ctx: HarnessCallbackContext) => string | Promise<string>);
  /** The Lab's project MCP servers (`projectMcpTools`), through which a report files. */
  mcpTools?: ProjectMcpToolsResolver;
  /** The conversation turn's options: its model and catalog. */
  agent?: Omit<AgentWorkerFlowOptions, "installation">;
}

/** A report run takes nothing from its caller: its row and dossier are read on the server. */
const reportInputSchema = z.object({}).strict();
const draftSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  stepsToReproduce: z.array(z.string()).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  suspectedCause: z.string().optional(),
  questions: z.array(z.string()).optional()
});
type Draft = z.infer<typeof draftSchema>;

/** The operator's answer to a preview: an ordinary form. */
export const previewAnswerSchema = z.object({
  decision: z.enum(["file", "dont-file"]).describe("File this issue, or don't file it"),
  instructions: z.string().optional().describe("Anything to change, add or answer before it files")
});
export type PreviewAnswer = z.infer<typeof previewAnswerSchema>;

/** A message item's text: its payload, or its payload's text parts, joined. */
function textOfItem(item: { payload: unknown }): string {
  const payload = item.payload;
  if (typeof payload === "string") return payload;
  const parts = Array.isArray(payload) ? payload : (payload as { content?: unknown } | null)?.content;
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join("");
}

/** The last ```json fence in `text` (or the whole text) parsed, or `undefined`. */
function lastJson(text: string | null | undefined): unknown {
  if (typeof text !== "string") return undefined;
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const candidate of [...fences.reverse(), text]) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // Try the next.
    }
  }
  return undefined;
}

/** The ids and links of one occurrence, as the issue's Context section lists them. */
function contextLines(row: ReportRow): string[] {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") lines.push(`- **${label}:** \`${String(value)}\``);
  };
  add("Fingerprint", row.fingerprint);
  add("Seen", `${row.count} time${row.count === 1 ? "" : "s"}`);
  add("Flow / action", `${row.parts.flowKind} / ${row.parts.actionName}`);
  add("Block", row.parts.blockPath);
  add("Error code", row.parts.code);
  add("Error", row.parts.message);
  const latest = row.occurrences.at(-1);
  if (latest !== undefined) {
    add("Request", latest.requestId);
    add("Session", latest.sessionId);
    add("User", latest.userId);
    add("Organization", latest.orgId);
    add("Task", latest.taskId);
    add("Board", latest.boardId);
  }
  for (const held of row.heldRequests ?? []) add("Failed request of the task", held.requestId);
  add("Project", row.context?.project);
  for (const [label, url] of Object.entries(row.context?.links ?? {})) lines.push(`- **${label}:** ${url}`);
  if (row.previousIssue !== undefined) lines.push(`- **Came back after:** ${row.previousIssue.identifier ?? ""} ${row.previousIssue.url}`.trim());
  if (row.storm !== undefined) {
    lines.push("", STORM_HEADING, "", "| Fingerprint | Count | Flow / action | Error |", "|---|---|---|---|");
    for (const entry of row.storm.entries) {
      lines.push(`| \`${entry.fingerprint}\` | ${entry.count} | ${entry.flowKind} / ${entry.actionName} | ${entry.message.replace(/\|/g, "\\|").slice(0, 200)} |`);
    }
  }
  return lines;
}

const CONTEXT_HEADING = "## Context";
const STORM_HEADING = "### Failures in this storm";

/** The issue's body: the harness's draft, then the Context section written by code from the row, so its ids are exact. */
function composeIssueBody(draft: Draft, row: ReportRow): string {
  const section = (title: string, text: string | undefined) => (text === undefined || text.trim() === "" ? [] : [`## ${title}`, "", text.trim(), ""]);
  const steps = draft.stepsToReproduce ?? [];
  return [
    ...section("Summary", draft.summary),
    ...(steps.length === 0 ? [] : ["## Steps to reproduce", "", ...steps.map((step, i) => `${i + 1}. ${step}`), ""]),
    ...section("Expected", draft.expected),
    ...section("Actual", draft.actual),
    ...section("Suspected cause", draft.suspectedCause),
    ...(row.description === undefined ? [] : ["## Reported by a user", "", row.description, ""]),
    CONTEXT_HEADING,
    "",
    ...contextLines(row)
  ].join("\n");
}

/** `body` with its Context section written again from `row`: a storm's list as it is now, not as it was drafted. */
function refreshContext(body: string, row: ReportRow): string {
  const at = body.lastIndexOf(CONTEXT_HEADING);
  return at < 0 ? body : `${body.slice(0, at)}${[CONTEXT_HEADING, "", ...contextLines(row)].join("\n")}`;
}

/** The values no report may hold: the environment's, the Lab's, and the running user's stored MCP keys. */
async function secretsFor(ctx: BlockContext, reporter: ErrorReporter): Promise<string[]> {
  const found = [...secretsFromEnv(process.env), ...(reporter.secrets?.() ?? [])];
  const keys = (ctx.resources as Record<string, unknown> | undefined)?.[MCP_CREDENTIALS_RESOURCE] as
    | { list(): Promise<Array<{ state: unknown }>> }
    | undefined;
  if (keys !== undefined) {
    try {
      for (const ref of await keys.list()) {
        const value = (ref.state as { value?: unknown } | undefined)?.value;
        if (typeof value === "string") found.push(value);
      }
    } catch {
      // Unreadable keys: the environment's and the Lab's are still taken out.
    }
  }
  return found;
}

/** Hard bound on the dossier handed to a run, in characters of JSON. */
const DOSSIER_LIMIT = 16_000;

/**
 * Build the Error Reporter's flow.
 *
 * @param options The reporter, the installation, the harness slot and where it reads the code.
 */
export function defineErrorReporterFlow(options: ErrorReporterFlowOptions) {
  const { reporter, installation } = options;
  const flowKind = reporter.flowKind;
  const secretsOf = (ctx: BlockContext) => secretsFor(ctx, reporter);

  /**
   * `ctx` as the tracker's project's run: its session reads as one linked to
   * the Lab's tracker project, so the project's MCP servers are the ones the
   * run gets. The project is the Lab's configuration, never a caller's.
   */
  const withTrackerProject = (ctx: HarnessCallbackContext): HarnessCallbackContext => {
    const project = reporter.tracker?.project;
    if (project === undefined) return ctx;
    const session = Object.create(ctx.session) as Record<string, unknown>;
    Object.defineProperty(session, "state", { value: { ...(ctx.session.state as object), [PROJECT_STATE_KEY]: project } });
    const view = Object.create(ctx) as Record<string, unknown>;
    Object.defineProperty(view, "session", { value: session });
    return view as unknown as HarnessCallbackContext;
  };

  /** The project MCP tools, every call's arguments redacted. */
  const redactedMcpTools: ProjectMcpToolsResolver | undefined =
    options.mcpTools === undefined
      ? undefined
      : Object.assign(
          async (ctx: HarnessCallbackContext) => {
            const servers = await options.mcpTools!(withTrackerProject(ctx));
            const secrets = await secretsOf(ctx as never);
            const wrapped: Record<string, RelayedMcpServer> = {};
            for (const [name, server] of Object.entries(servers)) {
              wrapped[name] = {
                ...server,
                tools: server.tools.map((tool) => ({ ...tool, call: (args, callOptions) => tool.call(redact(args, secrets), callOptions) }))
              };
            }
            return wrapped;
          },
          { named: (ctx: HarnessCallbackContext) => options.mcpTools!.named(withTrackerProject(ctx)) }
        );

  const cwd = options.cwd ?? process.cwd();
  const cwdFeed = typeof cwd === "string" ? () => cwd : cwd;
  // Drafting runs before the operator approved anything, so it gets no tracker tools.
  const draftHarness = options.harness({ cwd: cwdFeed });
  const trackerHarness = options.harness({ cwd: cwdFeed, ...(redactedMcpTools === undefined ? {} : { mcpTools: redactedMcpTools }) });

  /** The report this session runs, or a refusal: a report entry runs only in a report's own session. */
  const reportIdOf = (ctx: BlockContext): string => {
    const id = reportIdOfSession(ctx.session.identity.id);
    if (id === undefined) throw new Error(`Session "${ctx.session.identity.id}" is not an error report's session.`);
    return id;
  };

  /** The worker's instructions and the operator's standing rules, for a run's prompt. */
  const instructionsOf = async (ctx: BlockContext): Promise<string> => {
    const config = turnConfigOf(ctx as never);
    const body = typeof config.instructions === "string" ? config.instructions : "";
    let rules: string | undefined;
    try {
      rules = renderRules(await readStandingRules(ctx));
    } catch {
      rules = undefined;
    }
    return [body, rules].filter((part) => part !== undefined && part.trim() !== "").join("\n\n");
  };

  /** Write a line in the reporter's conversation, through its own entry there. Never fails the caller. */
  const sayInConversation = async (ctx: BlockContext, text: string): Promise<void> => {
    try {
      await reporter.say(text);
    } catch {
      ctx.emit.status(`Couldn't write to the reporter's conversation: ${text}`, { transient: false });
    }
  };

  // ---- report --------------------------------------------------------------

  /**
   * Claim the row for this run, through a compare-and-set: an owed row, or one
   * whose last run's claim has lapsed. A row approved but not filed yet goes
   * straight to filing. Anything else runs nothing.
   */
  const begin = handler({
    name: "error-reporter-begin",
    inputSchema: reportInputSchema,
    resources: { ...errorReportsResources },
    execute: async (_input, ctx) => {
      const id = reportIdOf(ctx as never);
      const sessionId = ctx.session.identity.id;
      // Only the operator's run drafts: the dossier reads every user's failures.
      if (ctx.session.identity.userId !== reporter.operator.userId) {
        throw new Error("Only the Lab's operator runs an error report.");
      }
      const by = ctx.request.identity.id;
      const now = Date.now();
      const reports = reportsOf(ctx as never);
      const row = await updateReport(reports, id, (current) => {
        const free = current.claim === undefined || current.claim.until <= now || current.claim.by === by;
        if (current.status === "owed" || (current.status === "drafting" && free)) {
          return { ...current, status: "drafting", runs: current.runs + 1, sessionId, claim: { by, until: now + CLAIM_LEASE_MS } };
        }
        if (current.status === "filing" && free) return { ...current, runs: current.runs + 1, sessionId, claim: { by, until: now + CLAIM_LEASE_MS } };
        return undefined;
      });
      if (row === undefined || row.claim?.by !== by) return { mode: "skip" as const };
      if (row.status === "filing") {
        return {
          mode: "file" as const,
          decision: "file" as const,
          title: row.draft?.title ?? row.parts.message.slice(0, 120),
          body: row.draft?.body ?? "",
          ...(row.approved?.instructions === undefined ? {} : { instructions: row.approved.instructions })
        };
      }
      const secrets = await secretsOf(ctx as never);
      const dossier = redact(await reporter.dossierOf(row), secrets);
      // What the Context section names beside the ids, kept so the draft needs no second dossier.
      const project = typeof dossier.project === "string" ? dossier.project : undefined;
      const links = dossier.links as Record<string, string> | undefined;
      if (project !== undefined || links !== undefined) {
        await updateReport(reports, id, (current) => ({ ...current, context: { ...(project === undefined ? {} : { project }), ...(links === undefined ? {} : { links }) } }));
      }
      let text = JSON.stringify(dossier, null, 2);
      if (text.length > DOSSIER_LIMIT) text = `${text.slice(0, DOSSIER_LIMIT)}\n… (cut)`;
      const instructions = await instructionsOf(ctx as never);
      const prompt = [
        instructions,
        "",
        "A failure in this system stayed failed. Investigate it and draft ONE bug report that an engineer can reproduce from.",
        "Read the code in your working directory to find where it fails and why. Do not change any file.",
        "The dossier below was gathered by code; its ids are exact. Refer to them, never invent one.",
        "Write steps to reproduce that a user could follow in a clean Lab: the message or action that trips it, and where.",
        "Keep the title to one short line, under ten words, naming what breaks: it heads the question in Inbox and the filed issue.",
        "List the questions you want the operator to answer before it files. They render as markdown, so put code in backticks.",
        "",
        "Dossier:",
        "```json",
        text,
        "```",
        "",
        'Reply with only one JSON object in a ```json fence: {"title": string, "summary": string, "stepsToReproduce": string[], "expected": string, "actual": string, "suspectedCause": string, "questions": string[]}'
      ].join("\n");
      return { mode: "draft" as const, prompt };
    }
  });

  /** The draft, redacted, on the row; the row moves to `previewing`. */
  const keepDraft = handler({
    name: "error-reporter-keep-draft",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (handle, ctx) => {
      const id = reportIdOf(ctx as never);
      const reports = reportsOf(ctx as never);
      const row = await readReport(reports, id);
      if (row === undefined) throw new Error(`Error report "${id}" is gone.`);
      const said = (handle as { finalMessage?: string | null } | undefined)?.finalMessage ?? null;
      // A harness may say something after its draft (a checkout's own
      // instructions can ask it to wrap up), so the draft is the newest of this
      // run's messages that holds one.
      const requestId = ctx.request.identity.id;
      const runMessages = ctx.session.items
        .all({ itemTypes: ["message"], roles: ["assistant"] })
        .filter((item) => item.requestId === requestId)
        .map((item) => textOfItem(item))
        .reverse();
      const parsed = [said, ...runMessages]
        .map((text) => draftSchema.safeParse(lastJson(text)))
        .find((attempt) => attempt.success) ?? draftSchema.safeParse(undefined);
      const secrets = await secretsOf(ctx as never);
      const draft: Draft = redact(
        parsed.success
          ? parsed.data
          : { title: `${row.parts.flowKind} / ${row.parts.actionName}: ${row.parts.message}`.slice(0, 120), summary: said ?? row.parts.message },
        secrets
      );
      const body = redact(composeIssueBody(draft, row), secrets);
      await updateReport(reports, id, (current) => ({
        ...current,
        status: "previewing",
        claim: undefined,
        draft: { title: draft.title, body, questions: draft.questions ?? [] }
      }));
      return { title: draft.title, body, questions: draft.questions ?? [] };
    }
  });

  /** The preview: an ordinary form in Inbox. Skipped for an error kind the Lab files without asking. */
  const preview = handler({
    name: "error-reporter-preview",
    inputSchema: z.object({ title: z.string(), body: z.string(), questions: z.array(z.string()) }),
    resources: { ...errorReportsResources },
    execute: async (draft, ctx): Promise<PreviewAnswer & { title: string; body: string }> => {
      const id = reportIdOf(ctx as never);
      const row = await readReport(reportsOf(ctx as never), id);
      const autoFile = reporter.preview?.autoFile ?? [];
      if (row !== undefined && (autoFile.includes(row.errorClass) || autoFile.includes(row.source))) {
        return { decision: "file", ...draft };
      }
      const seen = row?.count ?? 1;
      const questions = draft.questions.length === 0 ? "" : `\n\n**Questions**\n\n${draft.questions.map((q) => `- ${q}`).join("\n")}`;
      try {
        const answer = await ctx.suspend!({
          reason: "human_input",
          // The question's heading in Inbox; `data.title` is the issue title it files under.
          title: `Error report: ${draft.title}`,
          message: `Seen ${seen} time${seen === 1 ? "" : "s"}. File it?${questions}`,
          data: { reportId: id, title: draft.title, body: draft.body, questions: draft.questions, count: seen, decision: "file" },
          resumeSchema: previewAnswerSchema,
          allow: ["submit"],
          ...(reporter.preview?.autoFileAfterMs === undefined ? {} : { timeoutMs: reporter.preview.autoFileAfterMs })
        });
        const parsed = previewAnswerSchema.safeParse(answer);
        return parsed.success ? { ...parsed.data, ...draft } : { decision: "dont-file", ...draft };
      } catch (error) {
        // Unanswered past the Lab's `autoFileAfter`: it files as drafted.
        if (error instanceof SuspensionRejectedError && error.expired) return { decision: "file", ...draft };
        throw error;
      }
    }
  });

  /** A `Don't file`: the row is dismissed, and repeats are only counted until the hold ends. */
  const dismiss = handler({
    name: "error-reporter-dismiss",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (_input, ctx) => {
      const id = reportIdOf(ctx as never);
      const now = Date.now();
      const holdMs = reporter.limits?.dismissForMs ?? 24 * 60 * 60_000;
      await updateReport(reportsOf(ctx as never), id, (row) => ({ ...row, status: "dismissed", claim: undefined, dismissedUntil: now + holdMs }));
      return { filed: false as const };
    }
  });

  /**
   * The operator approved: the row is owed a filing from here on, with their
   * answer kept, so a filing that fails is retried rather than lost.
   */
  const approve = handler({
    name: "error-reporter-approve",
    inputSchema: z.object({ title: z.string(), body: z.string(), instructions: z.string().optional() }).passthrough(),
    resources: { ...errorReportsResources },
    execute: async (draft, ctx) => {
      const id = reportIdOf(ctx as never);
      const by = ctx.request.identity.id;
      const now = Date.now();
      const row = await updateReport(reportsOf(ctx as never), id, (current) =>
        current.status === "previewing" || (current.status === "filing" && current.claim?.by === by)
          ? {
              ...current,
              status: "filing",
              claim: { by, until: now + CLAIM_LEASE_MS },
              approved: draft.instructions === undefined ? {} : { instructions: draft.instructions }
            }
          : undefined
      );
      return { ...draft, skip: row?.status !== "filing" || row.claim?.by !== by };
    }
  });

  /** The prompt that files it, with the operator's answer folded in; a storm's list as it is now. */
  const filePrompt = handler({
    name: "error-reporter-file-prompt",
    inputSchema: z.object({ title: z.string(), body: z.string(), instructions: z.string().optional() }).passthrough(),
    resources: { ...errorReportsResources },
    execute: async (input, ctx) => {
      const tracker = reporter.tracker;
      const row = await readReport(reportsOf(ctx as never), reportIdOf(ctx as never));
      const body = row?.kind === "storm" ? redact(refreshContext(input.body, row), await secretsOf(ctx as never)) : input.body;
      const draft = { ...input, body };
      return {
        prompt: [
          `File this bug report as exactly ONE new issue in Linear, using the linear MCP tools${tracker?.hint === undefined ? "" : ` (${tracker.hint})`}.`,
          draft.instructions === undefined || draft.instructions.trim() === ""
            ? "The operator approved it as drafted."
            : `The operator answered: "${draft.instructions.trim()}". Fold that answer into the issue: apply what it asks (labels, priority, wording) and add what it tells you to the body.`,
          "Keep every line of the Context section exactly as written. Do not file a second issue.",
          "",
          `Title: ${draft.title}`,
          "",
          "Body:",
          draft.body,
          "",
          'After filing, reply with only one JSON object in a ```json fence: {"url": string, "identifier": string}'
        ].join("\n")
      };
    }
  });

  /** The filed issue on the row, and a line in the reporter's conversation. */
  const keepFiled = handler({
    name: "error-reporter-keep-filed",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (handle, ctx) => {
      const id = reportIdOf(ctx as never);
      const said = (handle as { finalMessage?: string | null } | undefined)?.finalMessage ?? null;
      const parsed = z.object({ url: z.string().min(1), identifier: z.string().optional() }).safeParse(lastJson(said));
      if (!parsed.success) {
        // The run couldn't file (a refusal, a tracker that was down): the row stays owed a filing, retried later.
        await updateReport(reportsOf(ctx as never), id, (row) => ({
          ...row,
          claim: undefined,
          lastRunError: `not filed: ${(said ?? "no answer").slice(0, 300)}`
        }));
        ctx.emit.message(`This report was not filed yet; it will be tried again: ${(said ?? "the run gave no answer").slice(0, 500)}`);
        return { filed: false as const, retry: true as const };
      }
      const now = Date.now();
      const row = await updateReport(reportsOf(ctx as never), id, (current) => ({
        ...current,
        status: "filed",
        issue: parsed.data,
        filedAt: now,
        countAtLastComment: current.count,
        claim: undefined,
        approved: undefined,
        lastRunError: undefined
      }));
      const line = `Filed ${parsed.data.identifier ?? "an issue"}: ${row?.draft?.title ?? id} ${parsed.data.url}`;
      ctx.emit.message(line);
      await sayInConversation(ctx as never, line);
      return { filed: true as const, ...parsed.data };
    }
  });

  /** No tracker named: the answer is kept, and nothing files. */
  const keepOnly = handler({
    name: "error-reporter-keep-only",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (_input, ctx) => {
      const id = reportIdOf(ctx as never);
      await updateReport(reportsOf(ctx as never), id, (row) => ({ ...row, status: "filed", filedAt: Date.now(), claim: undefined, approved: undefined }));
      ctx.emit.message("This Lab names no tracker, so the report is kept here and nothing was filed.");
      return { filed: false as const };
    }
  });

  const filing = sequencer({ name: "error-reporter-filing", inputSchema: z.any() })
    .step(approve)
    .stepIf((v: { skip?: boolean }) => v.skip !== true, filePrompt)
    .stepIf((v: { skip?: boolean }) => v.skip !== true, trackerHarness)
    .stepIf((v: { skip?: boolean }) => v.skip !== true, keepFiled);

  // `begin` says which way the run goes: `draft` drafts and previews; `file` (approved earlier) only files.
  // The harness's handle and the draft carry no `mode`, which is how the steps after them know they ran.
  const drafted = (v: unknown) => (v as { mode?: string }).mode === undefined;
  const report = sequencer({ name: "error-reporter-report", inputSchema: reportInputSchema })
    .step(begin)
    .stepIf((v: { mode: string }) => v.mode === "draft", (v: { prompt: string }) => ({ prompt: v.prompt }), draftHarness)
    .stepIf(drafted, keepDraft)
    .stepIf(drafted, preview)
    .stepIf((v: unknown) => (v as { decision?: string }).decision === "dont-file", dismiss)
    .stepIf((v: unknown) => (v as { decision?: string }).decision === "file" && reporter.tracker === undefined, keepOnly)
    .stepIf((v: unknown) => (v as { decision?: string }).decision === "file" && reporter.tracker !== undefined, filing);

  /** A report run that failed lets go of its row, so the next start (a restart included) runs it without waiting out the lease. */
  const releaseClaim = handler({
    name: "error-reporter-release",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (_input, ctx) => {
      const by = ctx.request.identity.id;
      await updateReport(reportsOf(ctx as never), reportIdOf(ctx as never), (row) => (row.claim?.by === by ? { ...row, claim: undefined } : undefined));
    }
  });

  // ---- comment -------------------------------------------------------------

  const commentPrompt = handler({
    name: "error-reporter-comment-prompt",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (_input, ctx) => {
      const id = reportIdOf(ctx as never);
      const row = await readReport(reportsOf(ctx as never), id);
      if (row === undefined || row.status !== "filed" || row.issue === undefined || row.commentOwed !== true) return { skip: true as const, prompt: "" };
      const secrets = await secretsOf(ctx as never);
      const since = row.count - (row.countAtLastComment ?? 1);
      const newest = row.occurrences.slice(-3).map((o) => [o.requestId && `request ${o.requestId}`, o.sessionId && `session ${o.sessionId}`, o.taskId && `task ${o.taskId}`].filter(Boolean).join(", "));
      return {
        skip: false as const,
        prompt: redact(
          [
            `Linear issue ${row.issue.identifier ?? ""} ${row.issue.url} was filed for a failure that has now happened ${row.count} times (${since} since it was filed or last commented on).`,
            "First read the issue with the linear MCP tools.",
            'If its state is completed or canceled, do not comment, and reply with only {"closed": true} in a ```json fence.',
            `Otherwise add exactly one comment saying it has now happened ${row.count} times, with the newest ids: ${newest.join("; ")}. Then reply with only {"closed": false} in a \`\`\`json fence.`
          ].join("\n"),
          secrets
        )
      };
    }
  });

  const keepComment = handler({
    name: "error-reporter-keep-comment",
    inputSchema: z.unknown(),
    resources: { ...errorReportsResources },
    execute: async (handle, ctx) => {
      const id = reportIdOf(ctx as never);
      const said = (handle as { finalMessage?: string | null }).finalMessage ?? null;
      const parsed = z.object({ closed: z.boolean() }).safeParse(lastJson(said));
      if (!parsed.success) {
        // No confirmed result: the comment stays owed, and the next start tries it again.
        await updateReport(reportsOf(ctx as never), id, (current) => ({ ...current, lastRunError: `not commented: ${(said ?? "no answer").slice(0, 300)}` }));
        ctx.emit.message(`The counted comment was not added yet; it will be tried again: ${(said ?? "the run gave no answer").slice(0, 500)}`);
        return { closed: false, commented: false };
      }
      const now = Date.now();
      const row = await updateReport(reportsOf(ctx as never), id, (current) =>
        parsed.data.closed
          ? { ...current, status: "closed", commentOwed: false }
          : { ...current, commentOwed: false, lastCommentAt: now, countAtLastComment: current.count, lastRunError: undefined }
      );
      if (row?.issue !== undefined) {
        await sayInConversation(
          ctx as never,
          parsed.data.closed
            ? `${row.issue.identifier ?? row.issue.url} is closed; its failure starts a new report next time.`
            : `Commented on ${row.issue.identifier ?? "the issue"}: seen ${row.count} times. ${row.issue.url}`
        );
      }
      return { closed: parsed.data.closed, commented: !parsed.data.closed };
    }
  });

  const comment = sequencer({ name: "error-reporter-comment", inputSchema: z.object({}).passthrough() })
    .step(commentPrompt)
    .stepIf((v: { skip: boolean }) => v.skip !== true, (v: { prompt: string }) => ({ prompt: v.prompt }), trackerHarness)
    .stepIf((v: unknown) => (v as { skip?: boolean }).skip !== true, keepComment);

  // ---- the conversation ----------------------------------------------------

  /** A user reports a problem: the same intake, preview and filing as a failure. */
  const reportProblem = handler({
    name: "reportProblem",
    description:
      "Report a problem the user describes, so it is investigated, previewed to the operator and filed like a failure. " +
      "Use it when the user tells you something went wrong. Do NOT use it for a standing rule about how you work.",
    inputSchema: z.object({
      description: z.string().min(1).describe("The problem, in the user's words, with what they did and what happened"),
      sessionId: z.string().optional().describe("A session the user named, if any"),
      taskId: z.string().optional().describe("A task the user named, if any"),
      project: z.string().optional().describe("A project the user named, if any")
    }),
    outputSchema: z.object({ decision: z.string(), reportId: z.string().optional() }),
    resources: { ...errorReportsResources },
    execute: async (input, ctx) => {
      const userId = ctx.session.identity.userId;
      if (userId === undefined) throw new Error("A problem is reported by a user; this session names none.");
      const named = { sessionId: input.sessionId, taskId: input.taskId, project: input.project };
      const decision = await intakeOccurrence(
        reportsOf(ctx as never),
        {
          kind: "manual",
          at: Date.now(),
          description: input.description,
          userId,
          sessionId: ctx.session.identity.id,
          ...(Object.values(named).some((v) => v !== undefined) ? { named } : {})
        },
        { reporterFlow: flowKind, limits: reporter.limits, secrets: await secretsOf(ctx as never) }
      );
      reporter.follow(decision);
      return { decision: decision.decision, ...("reportId" in decision ? { reportId: decision.reportId } : {}) };
    }
  });

  const turn = agentWorkerTurn(
    { ...(options.agent ?? {}), installation },
    { kind: flowKind, answerName: "error-reporter-answer", extraTools: [reportProblem as never] }
  );

  const door = sequencer({ name: "error-reporter-user-turn", inputSchema: turn.inputSchema }).tap(markUserTurnStep).step(turn.run);

  /** A line in this conversation: what the reporter filed or commented, with the link. */
  const line = handler({
    name: "error-reporter-line",
    inputSchema: z.object({ text: z.string() }),
    execute: async (input, ctx) => {
      ctx.emit.message(input.text);
      return {};
    }
  });

  const session = installation.session(turn.board?.sessionStateShape);

  return defineFlow({
    kind: flowKind,
    cardinality: "collection",
    configSchema: turn.settings,
    ...turn.bound,
    session,
    resources: { ...(turn.bound.resources ?? {}), ...errorReportsResources, ...workerMessagesResources },
    actions: {
      [RESPOND_ACTION]: { inputSchema: turn.inputSchema.strict(), block: door, userMessage: (input: { message: string }) => input.message },
      // Public so its preview is answerable from Inbox (a dispatched run is never reopened from outside).
      // It takes no input, runs only in a report's own session, and only for the operator.
      [REPORT_ENTRY]: { inputSchema: reportInputSchema, block: report, onErrored: releaseClaim },
      [STANDING_RULES_ACTION]: standingRulesAction,
      // Never on a report's session, which the reporter opens for its own work (FIX-2161).
      [SET_WORK_PROJECT_ACTION]: {
        inputSchema: setWorkProjectInputSchema,
        block: defineSetWorkProjectBlock((id) =>
          reportIdOfSession(id) === undefined ? undefined : "an error report's session, which the Error Reporter opens for its own work"
        )
      }
    },
    internal: {
      actions: {
        [COMMENT_ENTRY]: { inputSchema: z.object({}).passthrough(), block: comment },
        [LINE_ENTRY]: { inputSchema: z.object({ text: z.string() }), block: line },
        // A worker's message wakes the reporter's turn, as it does any worker's (FIX-2238).
        [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ turn: promptedMessageTurn(turn.run), installation, flowKind })
      }
    }
  } as never);
}

/** Options for {@link defineErrorReporterIntakeFlow}. */
export interface ErrorReporterIntakeFlowOptions {
  /** The reporter the intake starts runs for. */
  reporter: ErrorReporter;
}

/** A request occurrence as the failure event the Lab's filter is written against. */
function failureOf(occurrence: Extract<Occurrence, { kind: "request" }>): FinalFailureEvent {
  return {
    final: true,
    error: { message: occurrence.message, ...(occurrence.code === undefined ? {} : { code: occurrence.code }) },
    requestId: occurrence.requestId,
    flowKind: occurrence.flowKind,
    actionName: occurrence.actionName,
    userId: occurrence.userId,
    ...(occurrence.sessionId === undefined ? {} : { sessionId: occurrence.sessionId }),
    ...(occurrence.orgId === undefined ? {} : { orgId: occurrence.orgId }),
    ...(occurrence.blockName === undefined ? {} : { blockName: occurrence.blockName }),
    ...(occurrence.blockPath === undefined ? {} : { blockPath: occurrence.blockPath })
  };
}

/**
 * The reporter's intake, on a flow of its own: the one door every occurrence
 * comes in by. The reporter's capture runs it for a failed request; a board
 * dispatches it for a task that ended errored, from whatever flow the board
 * is on. It runs no worker and opens to no caller: its entries are internal.
 *
 * @param options The reporter.
 */
export function defineErrorReporterIntakeFlow(options: ErrorReporterIntakeFlowOptions) {
  const { reporter } = options;
  // ---- intake --------------------------------------------------------------

  const intake = handler({
    name: "error-reporter-intake",
    inputSchema: z.object({ occurrence: occurrenceSchema }),
    resources: { ...errorReportsResources },
    execute: async (input, ctx): Promise<IntakeDecision> => {
      const occurrence = input.occurrence;
      // A failure a flow rescued comes here without the capture: the Lab's filter decides it here too.
      if (occurrence.kind === "request" && !reporter.takes(failureOf(occurrence))) {
        return { decision: "ignored", reason: "the Lab's filter left it out" };
      }
      const decision = await intakeOccurrence(reportsOf(ctx as never), occurrence, {
        reporterFlow: reporter.flowKind,
        limits: reporter.limits,
        secrets: await secretsFor(ctx as never, reporter)
      });
      // Taken: the board's owed mark is cleared here, once the report holds it, never on the send alone.
      if (occurrence.kind === "task" && occurrence.partition !== undefined) {
        const ledger = await conversationLedgerAt(ctx as never, occurrence.partition);
        await ledger?.patchMetadata(occurrence.taskId, { [reportOwedKey(occurrence.attempt)]: null });
      }
      reporter.follow(decision);
      return decision;
    }
  });

  const reportsRead = handler({
    name: "error-reporter-reports",
    inputSchema: z.discriminatedUnion("op", [z.object({ op: z.literal("get"), id: z.string() }), z.object({ op: z.literal("all") })]),
    resources: { ...errorReportsResources },
    execute: async (input, ctx) => {
      const reports = reportsOf(ctx as never);
      if (input.op === "get") return { rows: [await readReport(reports, input.id)].filter((r) => r !== undefined) };
      return { rows: await listReports(reports) };
    }
  });

  return defineFlow({
    kind: ERROR_REPORTER_INTAKE_FLOW,
    resources: { ...errorReportsResources, ...conversationLedgerResources, [MCP_CREDENTIALS_RESOURCE]: defineMcpCredentialsCollection() },
    actions: {},
    internal: {
      actions: {
        [INTAKE_ENTRY]: { inputSchema: z.object({ occurrence: occurrenceSchema }), block: intake, concurrency: "allow" },
        [REPORTS_ENTRY]: { inputSchema: z.any(), block: reportsRead }
      }
    }
  } as never);
}
