/**
 * The session's pull-request record: one row per pull request the session
 * opened, whichever harness or generator opened it.
 *
 * A coding run can open several pull requests, and the links are already in
 * the stream: every harness and the generator emit each tool call as a
 * `tool_output` item with its arguments and output. This file reads them out
 * and keeps them. It is a record of what the session opened, never a work
 * queue: nothing in it starts work, and nothing a client sends writes to it.
 *
 * This file owns:
 *
 * - {@link OBSERVED_PULL_REQUESTS} / {@link observedPullRequestsCollection} /
 *   {@link observedPullRequestStateSchema} — the rows. Neutral: host,
 *   repository, number and link. A row's key is
 *   {@link pullRequestKey}, never the link string, which varies.
 * - {@link PullRequestRule} / {@link githubPullRequestRule} /
 *   {@link findOpenedPullRequests} — what counts as "opened": a create call
 *   whose result names the pull request. GitHub is the one rule set shipped;
 *   another forge is another rule, not another record. The rules read text the
 *   tool calls already returned. Core holds no forge client.
 * - {@link writePullRequests} — the one write path. Every writer goes through
 *   it: the recorder (`../helpers/pull-request-recorder`), a host's turn-end
 *   branch check, and a harness handle that names a pull request.
 *
 * It sits beside `./harness-plan` (what a run planned) and copies its shape: a
 * session-scoped, live, lazy collection a block declares and a page reads.
 */
import { z } from "zod";
import type { RuntimeItem } from "../items/internal";
import { defineResourceCollection } from "./resource-collection";
import { planKeySegment } from "./harness-plan";

/** Accessor key AND storage prefix for the pull-request rows. */
export const OBSERVED_PULL_REQUESTS = "observed-pull-requests" as const;

/**
 * How a row was found.
 *
 * - `tool` — a create call in the session's tool calls named it.
 * - `branch` — a host's turn-end check found it on the session's branch.
 *
 * A `tool` sighting upgrades a `branch` row, so a branch check that wins the
 * race does not hide the turn that opened it.
 */
export type PullRequestSource = "tool" | "branch";

/**
 * One pull request, keyed by {@link pullRequestKey}.
 *
 * `requestId` is a read key: a reader narrows a shared session's rows to the
 * request that opened them by it (a task's run, a turn). It is set once and
 * never moved. `state` is what was seen when the row was written (at opening,
 * or at the branch check), not kept current after the session. Every field is
 * nullable with a null default (BP-023), so a row written by an older or newer
 * shape still parses.
 */
export const observedPullRequestStateSchema = z.object({
  /** The forge's host, lower-cased (`github.com`). */
  host: z.string().nullable().default(null),
  /** `owner/name`, as the link spelled it. */
  repository: z.string().nullable().default(null),
  /** The pull request's number. */
  number: z.number().int().nullable().default(null),
  /** The pull request's web link. */
  url: z.string().nullable().default(null),
  /** Its title, when the create call or the check said. */
  title: z.string().nullable().default(null),
  /** `open`, `closed`, `merged` or `draft`, as last seen. */
  state: z.string().nullable().default(null),
  /** The branch it merges from, when known. */
  branch: z.string().nullable().default(null),
  /** The request that opened it. A read key. */
  requestId: z.string().nullable().default(null),
  /** How it was found. See {@link PullRequestSource}. */
  source: z.enum(["tool", "branch"]).nullable().default(null),
  /** Epoch millis it was first recorded. */
  firstSeenAt: z.number().nullable().default(null),
});

/** One row of {@link observedPullRequestsCollection}. */
export type ObservedPullRequestState = z.infer<typeof observedPullRequestStateSchema>;

/**
 * The session's pull-request rows.
 *
 * Lazy for the reason the plan record is: a session is reused across runs, and
 * an eager collection loads every row before a writer touches one key. A
 * writer reads and upserts by exact key and never lists. `live` streams each
 * row to an open page as it is written, mid-turn. The client reads; nothing
 * the client sends writes.
 */
export const observedPullRequestsCollection = defineResourceCollection({
  pattern: `${OBSERVED_PULL_REQUESTS}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: observedPullRequestStateSchema,
  client: {
    state: { read: true },
    expose: ["host", "repository", "number", "url", "title", "state", "branch", "requestId", "source", "firstSeenAt"],
    live: true,
  },
});

/** A pull request a rule or a check found. */
export interface PullRequestRef {
  /** The forge's host (`github.com`). */
  readonly host: string;
  /** The repository's owner. */
  readonly owner: string;
  /** The repository's name. */
  readonly name: string;
  readonly number: number;
  /** The pull request's web link. */
  readonly url: string;
  readonly title?: string | null;
  readonly state?: string | null;
  readonly branch?: string | null;
}

/**
 * The parts of a tool call a rule reads: the tool's name, its arguments (a
 * JSON string or a value), and its output (any shape).
 */
export interface PullRequestToolCall {
  readonly name: string;
  readonly arguments: unknown;
  readonly output: unknown;
}

/** A forge's rule: the pull requests one settled tool call opened, or `[]`. */
export interface PullRequestRule {
  /** For status notes. */
  readonly name: string;
  match(call: PullRequestToolCall): PullRequestRef[];
}

/**
 * A row's key: host, owner, repository and number, one segment each, escaped
 * with {@link planKeySegment}. Host, owner and repository are lower-cased,
 * because GitHub reads them case-insensitively, so two spellings of one link
 * land on one row.
 */
export function pullRequestKey(ref: Pick<PullRequestRef, "host" | "owner" | "name" | "number">): string {
  return [ref.host, ref.owner, ref.name]
    .map((part) => planKeySegment(part.toLowerCase()))
    .concat(String(ref.number))
    .join("/");
}

/** Every string inside `value`, depth-first, parsing a JSON string once. */
function stringsIn(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") {
    out.push(value);
    const trimmed = value.trim();
    if (depth === 0 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        stringsIn(JSON.parse(trimmed), depth + 1, out);
      } catch {
        // Not JSON: the string itself is already in.
      }
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) stringsIn(entry, depth + 1, out);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) stringsIn(entry, depth + 1, out);
  }
  return out;
}

/** The arguments as an object, when they are one or a JSON string of one. */
function argumentsObject(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed: unknown = JSON.parse(args);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

/**
 * A tool's own name, without the prefix a harness puts on an MCP tool: Codex's
 * `mcp:<server>/<tool>`, Claude Code's `mcp__<server>__<tool>`.
 */
function bareToolName(name: string): string {
  const codex = /^mcp:[^/]*\/(.+)$/.exec(name);
  if (codex?.[1] !== undefined) return codex[1];
  const claude = /^mcp__.+?__(.+)$/.exec(name);
  if (claude?.[1] !== undefined) return claude[1];
  return name;
}

/** `gh pr create` (or its alias `gh pr new`), anywhere in a command line. */
const GH_PR_CREATE = /(?:^|[\s;&|("'`])gh\s+pr\s+(?:create|new)\b/;

/**
 * A pull request's web link. `/pull/new/<branch>` (the link `git push`
 * prints) is not a pull request, and its next segment is not a number.
 */
const PULL_LINK = /https?:\/\/([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?![\d])/g;

/** A flag's value in a command line: `--title 'x'`, `--title="x"`, `-t x`. */
function flagValue(command: string, flags: readonly string[]): string | null {
  for (const flag of flags) {
    const pattern = new RegExp(`(?:^|\\s)${flag}(?:\\s+|=)(?:'([^']*)'|"((?:[^"\\\\]|\\\\.)*)"|([^\\s'"]+))`);
    const found = pattern.exec(command);
    if (found !== null) return found[1] ?? found[2]?.replace(/\\(.)/g, "$1") ?? found[3] ?? null;
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** A link found in text, as a ref with no title, state or branch. */
export type PullRequestLink = Omit<PullRequestRef, "title" | "state" | "branch">;

function refOfMatch(m: RegExpMatchArray): PullRequestLink | null {
  const [, host, owner, name, num] = m;
  if (host === undefined || owner === undefined || name === undefined || num === undefined) return null;
  // `www.github.com` is github.com: one host, so one key.
  const bare = host.toLowerCase().replace(/^www\./, "");
  return { host: bare, owner, name, number: Number(num), url: `https://${bare}/${owner}/${name}/pull/${num}` };
}

/**
 * A pull request's web link read as a ref (host, owner, name, number and the
 * normalized `url`), or `null` when `url` does not start with one. The one
 * reading of a link every writer keys by, so a link found in a tool's output
 * and the same pull request listed by a host check are one row.
 */
export function pullRequestRefFromUrl(url: string): PullRequestLink | null {
  const m = new RegExp(`^${PULL_LINK.source}`).exec(url);
  return m === null ? null : refOfMatch(m);
}

/** The distinct pull-request links in `texts`, in first-seen order. */
function linksIn(texts: readonly string[]): PullRequestLink[] {
  const found = new Map<string, PullRequestLink>();
  for (const text of texts) {
    for (const m of text.matchAll(PULL_LINK)) {
      const ref = refOfMatch(m);
      if (ref === null) continue;
      const key = pullRequestKey(ref);
      if (!found.has(key)) found.set(key, ref);
    }
  }
  return [...found.values()];
}

/**
 * The pull request a create-pull-request tool's result describes: the
 * outermost object whose `html_url` (else `url`) is a pull request's web link.
 * JSON strings are parsed, so a result wrapped in a text block reads too.
 * `null` when no object names one.
 */
function createdPullRequestIn(output: unknown): PullRequestLink | null {
  let level: unknown[] = [output];
  for (let depth = 0; depth <= 8 && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const value of level) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
        try {
          next.push(JSON.parse(trimmed));
        } catch {
          // Not JSON: no fields to read.
        }
      } else if (Array.isArray(value)) {
        next.push(...value);
      } else if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        for (const key of ["html_url", "url"]) {
          const link = stringField(record, key);
          const ref = link === null ? null : pullRequestRefFromUrl(link);
          if (ref !== null) return ref;
        }
        next.push(...Object.values(record));
      }
    }
    level = next;
  }
  return null;
}

/**
 * GitHub's rule, for github.com and GitHub Enterprise hosts.
 *
 * A call is a create call when its command runs `gh pr create` (or `gh pr
 * new`), or when the tool is a create-pull-request tool (GitHub's MCP
 * `create_pull_request`, under any harness's prefix). A create call opens one
 * pull request, read from the call's OUTPUT: the tool's result fields
 * (`html_url`, else `url`), or the first link `gh pr create` prints. Other links
 * in the output, such as one the new pull request's body names, are not
 * opened. The command is read from the arguments, never the link, so a link
 * the agent only typed is not a pull request it opened. A `gh pr view`, `gh pr
 * list` or search names links and is not a create call.
 *
 * A create that fails because the branch already has a pull request still
 * names it ("already exists: <link>"), and it counts: the session's branch has
 * it. The title and branch come from the create call's own flags or fields
 * when it set them.
 */
export const githubPullRequestRule: PullRequestRule = {
  name: "github",
  match(call) {
    const args = argumentsObject(call.arguments);
    const tool = bareToolName(call.name);
    let title: string | null = null;
    let branch: string | null = null;
    let created: PullRequestLink | null = null;
    if (tool === "create_pull_request") {
      title = stringField(args, "title");
      branch = stringField(args, "head");
      created = createdPullRequestIn(call.output);
    } else {
      // The parsed fields first, so a quoted title reads unescaped; the raw
      // arguments last, for a harness that passes a bare command string.
      const texts = typeof call.arguments === "string" ? [...stringsIn(args), call.arguments] : stringsIn(call.arguments);
      const command = texts.find((text) => GH_PR_CREATE.test(text));
      if (command === undefined) return [];
      title = flagValue(command, ["--title", "-t"]);
      branch = flagValue(command, ["--head", "-H"]);
    }
    // A result with no structured fields (plain text, an "already exists"
    // error) names the pull request as its first link.
    created ??= linksIn(stringsIn(call.output))[0] ?? null;
    return created === null ? [] : [{ ...created, title, branch, state: "open" }];
  },
};

/** The default rules: GitHub's. */
export const DEFAULT_PULL_REQUEST_RULES: readonly PullRequestRule[] = [githubPullRequestRule];

/**
 * The pull requests a settled tool call names as opened, by the given rules
 * (GitHub's by default). `[]` for any item that is not a `tool_output` with
 * an output, and for any call no rule reads as a create.
 */
export function findOpenedPullRequests(
  item: RuntimeItem,
  rules: readonly PullRequestRule[] = DEFAULT_PULL_REQUEST_RULES,
): PullRequestRef[] {
  if (item.type !== "tool_output") return [];
  const tool = item as { output?: unknown; toolCall?: { name?: unknown; arguments?: unknown } };
  if (tool.output === undefined || tool.output === null) return [];
  const call: PullRequestToolCall = {
    name: typeof tool.toolCall?.name === "string" ? tool.toolCall.name : "",
    arguments: tool.toolCall?.arguments,
    output: tool.output,
  };
  const found = new Map<string, PullRequestRef>();
  for (const rule of rules) {
    for (const ref of rule.match(call)) {
      const key = pullRequestKey(ref);
      if (!found.has(key)) found.set(key, ref);
    }
  }
  return [...found.values()];
}

/** The slice of a collection ref {@link writePullRequests} uses. No `list`: it loads the whole prefix. */
export interface PullRequestCollection {
  getOptional(key: string): Promise<{ readonly state: Record<string, unknown> } | undefined>;
  upsert(key: string, update: Record<string, unknown>): Promise<unknown>;
}

/** What a writer says about the refs it writes. */
export interface WritePullRequestsOptions {
  /** How they were found. */
  readonly source: PullRequestSource;
  /** The request that opened them, when the writer knows it. */
  readonly requestId?: string | null;
  readonly now?: () => number;
}

/**
 * The one write path. Upserts each ref by {@link pullRequestKey}:
 *
 * - A new key is written whole, with `firstSeenAt`.
 * - An existing row keeps `requestId` and `firstSeenAt` once set; a later
 *   sighting only fills a null `title`, `state`, `branch`, `requestId` or
 *   `url`. That is what lands a repeated link, a second recorder and the
 *   branch check on one row.
 * - A `tool` sighting upgrades a `branch` row's `source`.
 *
 * Writes run one after another, so two refs to one key in a call never race.
 * Throws what the store throws; a caller that must not fail on bookkeeping
 * catches it.
 */
export async function writePullRequests(
  collection: PullRequestCollection,
  refs: readonly PullRequestRef[],
  options: WritePullRequestsOptions,
): Promise<void> {
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? null;
  for (const ref of refs) {
    const key = pullRequestKey(ref);
    const sighting: Record<string, unknown> = {
      host: ref.host.toLowerCase(),
      repository: `${ref.owner}/${ref.name}`,
      number: ref.number,
      url: ref.url,
      title: ref.title ?? null,
      state: ref.state ?? null,
      branch: ref.branch ?? null,
      requestId,
    };
    const prior = (await collection.getOptional(key))?.state;
    if (prior === undefined) {
      await collection.upsert(key, { ...sighting, source: options.source, firstSeenAt: now() });
      continue;
    }
    const update: Record<string, unknown> = {};
    for (const field of ["url", "title", "state", "branch", "requestId"] as const) {
      if ((prior[field] === null || prior[field] === undefined) && sighting[field] !== null) update[field] = sighting[field];
    }
    if (options.source === "tool" && prior.source !== "tool") update.source = "tool";
    if (Object.keys(update).length > 0) await collection.upsert(key, update);
  }
}
