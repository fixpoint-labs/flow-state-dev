// FIX-2535; epic FIX-2471 ER-6, ER-8.
/**
 * GitHub's normalize: one GitHub event, as a webhook delivers it or as a poll
 * rebuilds it from the API objects, to zero or more normalized events.
 * Pure: no clock, no network, so a redelivery and a poll of the same change
 * name the same object at the same version.
 *
 * **The signature is pinned** ({@link normalizeGitHubEvent}): the webhook
 * route and the poll call the same function. A poll hands it the event
 * name and an object of the webhook payload's shape, built from the API
 * objects the payload embeds (a review, a comment, a check run, a pull
 * request or issue), so both read one field for each part.
 *
 * **Object and version (the one contract the poll consumes).**
 *
 * - A review, a comment and a check run are objects GitHub keeps under its own
 *   id: `review:<id>`, `review_comment:<id>`, `issue_comment:<id>`,
 *   `check_run:<id>`, versioned by their own last-changed time (`submitted_at`,
 *   `updated_at`, `completed_at`), in ms.
 * - A pull request or an issue is never the object (its `updated_at` moves
 *   with any activity). Its events are occurrences:
 *   `pull_request:<thread>:<action>:<subject>` (or `issue:…`), with `<thread>`
 *   the pinned thread key ({@link githubThreadKey}) and `<subject>` the
 *   assignee or reviewer named, lower-cased, empty for the other actions;
 *   versioned by the occurrence's own time (`created_at` for `opened`,
 *   `closed_at` for `closed`, otherwise the `updated_at` the change set).
 * - Never the delivery's id or time: those are provenance only.
 *
 * **Threads (pinned).** `github:<owner>/<repo>`, then `github:<owner>/<repo>#<n>`,
 * lower-cased as `pullRequestKey` lower-cases. A check run on two pull requests
 * is one event per pull request; one on none is the repository's alone.
 *
 * **The kinds (pinned).** `review` (submitted), `comment` (created or edited, on an
 * issue, a pull request, or a review line), `check` (a completed run), and
 * `pull_request` / `issue` (opened, closed, reopened, assigned, review
 * requested). Anything else normalizes to nothing.
 *
 * **Sender (epic Q1).** From the acting object's `author_association`:
 * `OWNER`/`MEMBER` → `member`, `COLLABORATOR` → `collaborator`, any other →
 * `outsider`, none → `unknown`; a `Bot` sender → `bot`. Ids are lower-cased
 * logins, a bot's without `[bot]`. A check run is sent by the app that ran
 * it (`check_run.app.slug`, a `bot`), not by whoever pushed.
 *
 * **`addressed`.** `true` when the event mentions one of the app's agent
 * handles (outside quoted lines and code), assigns one, or requests its review.
 * A mention of anyone else never asks the agent.
 */
import { MAX_SUBSCRIPTION_EVENT_TEXT, type SubscriptionEvent } from "@flow-state-dev/core/types";

/** The provider key GitHub's events and thread keys carry. */
export const GITHUB_PROVIDER = "github";

/** One GitHub event, as the webhook route or a poll hands it to {@link normalizeGitHubEvent}. **Pinned.** */
export interface GitHubEventInput {
  /** The event name: the webhook's `X-GitHub-Event` (`pull_request_review`, `check_run`, …). */
  readonly eventType: string;
  /** The webhook payload, or a poll's object of the same shape. */
  readonly payload: unknown;
  /** When the service received it, in ms. */
  readonly received: number;
  /** The webhook's delivery id: provenance only. */
  readonly deliveryId?: string;
}

/** What normalize reads besides the event. */
export interface GitHubNormalizeOptions {
  /** The app's agent handles (logins, any case, `[bot]` or not): an event that mentions, assigns or asks one for review is `addressed`. */
  readonly agentHandles?: readonly string[];
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) ? value : undefined);

/** A GitHub login as an id: lower-cased, without a bot's `[bot]`. */
export function githubLoginId(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/, "");
}

/**
 * A GitHub thread key: `github:<owner>/<repo>`, or with `#<n>` for a pull
 * request or issue, lower-cased. **Pinned**: subscriptions and the index store it.
 */
export function githubThreadKey(repository: string, number?: number): string {
  const repo = `${GITHUB_PROVIDER}:${repository.toLowerCase()}`;
  return number === undefined ? repo : `${repo}#${number}`;
}

/** A GitHub timestamp in ms, or `undefined` when it isn't one. */
function msOf(value: unknown): number | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function roleOf(sender: Json | undefined, association: unknown): SubscriptionEvent["sender"]["role"] {
  if (sender?.type === "Bot") return "bot";
  const a = str(association);
  if (a === undefined) return "unknown";
  if (a === "OWNER" || a === "MEMBER") return "member";
  if (a === "COLLABORATOR") return "collaborator";
  return "outsider";
}

/** A fence's opening line: up to 3 spaces, then a run of 3 or more backticks or tildes, then its info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A line that can close a fence: up to 3 spaces, a run, then nothing but spaces. */
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;

/**
 * A body with its code blanked, read by CommonMark's rules for the two
 * constructs a mention hides in, line by line:
 *
 * - **Fenced code blocks.** A line with up to 3 spaces of indent and a run of
 *   3 or more backticks or tildes opens one (a backtick fence's info string
 *   may not hold a backtick). It closes only on a line holding a run of the
 *   same character at least as long, with up to 3 spaces of indent and nothing
 *   after it but spaces. Unclosed, it runs to the end of the body. A fence ends
 *   the paragraph before it.
 * - **Code spans**, within a paragraph (the lines between blank lines and
 *   fences): a run of N backticks opens one, which closes only at the next run
 *   of exactly N. An unmatched run is literal text.
 *
 * Indented code blocks (4 or more spaces) are not read as code: a GitHub
 * comment rarely holds a mention in one, and telling one from a paragraph's
 * indented continuation line needs the full block structure. A mention there
 * still reads as a mention. Backslash escapes are not read either.
 */
function withoutCode(body: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let fence: { char: string; length: number } | undefined;
  const endParagraph = () => {
    if (paragraph.length > 0) out.push(withoutCodeSpans(paragraph.join("\n")));
    paragraph = [];
  };
  for (const line of body.split("\n")) {
    if (fence !== undefined) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close !== undefined && close[0] === fence.char && close.length >= fence.length) fence = undefined;
      out.push("");
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null && !(open[1]![0] === "`" && open[2]!.includes("`"))) {
      endParagraph();
      fence = { char: open[1]![0]!, length: open[1]!.length };
      out.push("");
    } else if (line.trim() === "") {
      endParagraph();
      out.push(line);
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return out.join("\n");
}

/** One paragraph with its code spans blanked: a run of N backticks pairs with the next run of exactly N. */
function withoutCodeSpans(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((run) => ({ start: run.index, length: run[0].length }));
  let result = "";
  let from = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    const j = runs.findIndex((run, k) => k > i && run.length === open.length);
    if (j === -1) continue;
    result += `${text.slice(from, open.start)} `;
    from = runs[j]!.start + open.length;
    i = j;
  }
  return result + text.slice(from);
}

/**
 * The logins a body mentions, lower-cased, outside quoted lines and code
 * (fenced blocks and code spans, as {@link withoutCode} reads them): a quoted
 * reply or a pasted snippet asks no one. An `@` inside a word (an email
 * address) is no mention.
 */
export function githubMentions(body: string): string[] {
  const unquoted = withoutCode(body)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  const found = new Set<string>();
  for (const match of unquoted.matchAll(/(^|[^A-Za-z0-9_@./-])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?)/g)) {
    found.add(githubLoginId(match[2]!));
  }
  return [...found];
}

const cut = (text: string): string => (text.length > MAX_SUBSCRIPTION_EVENT_TEXT ? `${text.slice(0, MAX_SUBSCRIPTION_EVENT_TEXT - 1)}…` : text);

const labelsOf = (subject: Json | undefined): string[] =>
  (Array.isArray(subject?.labels) ? subject!.labels : []).flatMap((label) => {
    const name = str(obj(label)?.name);
    return name === undefined ? [] : [name];
  });

const PR_ACTIONS = new Set(["opened", "closed", "reopened", "assigned", "review_requested"]);
const ISSUE_ACTIONS = new Set(["opened", "closed", "reopened", "assigned"]);

/**
 * One GitHub event as zero or more normalized events. **Pinned**: the webhook
 * route and the poll call this one function.
 */
export function normalizeGitHubEvent(input: GitHubEventInput, options: GitHubNormalizeOptions = {}): SubscriptionEvent[] {
  const payload = obj(input.payload);
  const repository = obj(payload?.repository);
  const fullName = str(repository?.full_name);
  if (payload === undefined || fullName === undefined) return [];
  const handles = new Set((options.agentHandles ?? []).map(githubLoginId));
  const asks = (...logins: Array<string | undefined>) => logins.some((login) => login !== undefined && handles.has(githubLoginId(login)));
  const mentionsAgent = (body: string) => handles.size > 0 && githubMentions(body).some((login) => handles.has(login));
  const action = str(payload.action) ?? "";
  const sender = obj(payload.sender);
  const senderLogin = str(sender?.login) ?? "";
  const repoThread = githubThreadKey(fullName);
  const audience: SubscriptionEvent["audience"] = repository?.private === true ? "private" : "public";

  const event = (parts: {
    number?: number;
    kind: string;
    id: string;
    version: number | undefined;
    association: unknown;
    title: string;
    text: string;
    labels: string[];
    url: string;
    closes?: boolean;
    addressed?: boolean;
    /** Who sent it, when not the delivery's sender (a check run's app). */
    from?: SubscriptionEvent["sender"];
  }): SubscriptionEvent[] => {
    if (parts.version === undefined || (parts.from === undefined && senderLogin === "")) return [];
    return [
      {
        provider: GITHUB_PROVIDER,
        threads: parts.number === undefined ? [repoThread] : [repoThread, githubThreadKey(fullName, parts.number)],
        kind: parts.kind,
        object: { id: parts.id, version: parts.version },
        sender: parts.from ?? { id: githubLoginId(senderLogin), name: senderLogin, role: roleOf(sender, parts.association) },
        audience,
        title: parts.title,
        text: cut(parts.text),
        labels: parts.labels,
        url: parts.url,
        received: input.received,
        at: parts.version,
        ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }),
        ...(parts.closes === true ? { closes: true as const } : {}),
        ...(parts.addressed === true ? { addressed: true as const } : {})
      }
    ];
  };

  switch (input.eventType) {
    case "pull_request_review": {
      const review = obj(payload.review);
      const pr = obj(payload.pull_request);
      const number = num(pr?.number);
      const reviewId = num(review?.id);
      if (action !== "submitted" || review === undefined || number === undefined || reviewId === undefined) return [];
      const body = str(review.body) ?? "";
      const state = (str(review.state) ?? "commented").toLowerCase();
      return event({
        number,
        kind: "review",
        id: `review:${reviewId}`,
        version: msOf(review.submitted_at),
        association: review.author_association,
        title: `Review (${state}) on #${number}: ${str(pr?.title) ?? ""}`,
        text: body,
        labels: labelsOf(pr),
        url: str(review.html_url) ?? str(pr?.html_url) ?? "",
        addressed: mentionsAgent(body)
      });
    }
    case "pull_request_review_comment":
    case "issue_comment": {
      const comment = obj(payload.comment);
      const subject = obj(input.eventType === "issue_comment" ? payload.issue : payload.pull_request);
      const number = num(subject?.number);
      const commentId = num(comment?.id);
      if ((action !== "created" && action !== "edited") || comment === undefined || number === undefined || commentId === undefined) return [];
      const body = str(comment.body) ?? "";
      const prefix = input.eventType === "issue_comment" ? "issue_comment" : "review_comment";
      return event({
        number,
        kind: "comment",
        id: `${prefix}:${commentId}`,
        version: msOf(comment.updated_at) ?? msOf(comment.created_at),
        association: comment.author_association,
        title: `Comment on #${number}: ${str(subject?.title) ?? ""}`,
        text: body,
        labels: labelsOf(subject),
        url: str(comment.html_url) ?? "",
        addressed: mentionsAgent(body)
      });
    }
    case "check_run": {
      const run = obj(payload.check_run);
      const runId = num(run?.id);
      if (action !== "completed" || run === undefined || runId === undefined) return [];
      const output = obj(run.output);
      // A check run is the app's: it reports as the app that ran it (`github-actions`), a bot the service lists or not.
      const app = obj(run.app);
      const appSlug = str(app?.slug);
      const from = appSlug === undefined ? undefined : { id: githubLoginId(appSlug), name: str(app?.name) ?? appSlug, role: "bot" as const };
      const base = {
        ...(from === undefined ? {} : { from }),
        kind: "check",
        id: `check_run:${runId}`,
        version: msOf(run.completed_at),
        association: undefined,
        title: `Check ${str(run.name) ?? ""}: ${str(run.conclusion) ?? "completed"}`,
        text: [str(output?.title), str(output?.summary)].filter((part) => part !== undefined).join("\n"),
        labels: [],
        url: str(run.html_url) ?? ""
      };
      const numbers = [
        ...new Set(
          (Array.isArray(run.pull_requests) ? run.pull_requests : []).flatMap((pr) => {
            const n = num(obj(pr)?.number);
            return n === undefined ? [] : [n];
          })
        )
      ];
      // A check on two pull requests is one event per pull request; on none, the repository's alone.
      return numbers.length === 0 ? event(base) : numbers.flatMap((number) => event({ ...base, number }));
    }
    case "pull_request":
    case "issues": {
      const isPr = input.eventType === "pull_request";
      const subject = obj(isPr ? payload.pull_request : payload.issue);
      const number = num(subject?.number);
      if (subject === undefined || number === undefined || !(isPr ? PR_ACTIONS : ISSUE_ACTIONS).has(action)) return [];
      // An issue event about a pull request is the pull request's own event's to tell.
      if (!isPr && subject.pull_request !== undefined) return [];
      const assignee = action === "assigned" ? str(obj(payload.assignee)?.login) : undefined;
      const reviewer = action === "review_requested" ? (str(obj(payload.requested_reviewer)?.login) ?? str(obj(payload.requested_team)?.slug)) : undefined;
      const subjectLogin = assignee ?? reviewer;
      const thread = githubThreadKey(fullName, number);
      const version =
        action === "opened" ? msOf(subject.created_at) : action === "closed" ? (msOf(subject.closed_at) ?? msOf(subject.updated_at)) : msOf(subject.updated_at);
      const author = str(obj(subject.user)?.login);
      const merged = action === "closed" && subject.merged === true;
      const what = isPr ? "Pull request" : "Issue";
      const words =
        action === "assigned"
          ? `assigned to ${assignee ?? "someone"}`
          : action === "review_requested"
            ? `review requested from ${reviewer ?? "someone"}`
            : merged
              ? "merged"
              : action;
      const body = str(subject.body) ?? "";
      return event({
        number,
        kind: isPr ? "pull_request" : "issue",
        id: `${isPr ? "pull_request" : "issue"}:${thread}:${action}:${subjectLogin === undefined ? "" : githubLoginId(subjectLogin)}`,
        version,
        // The subject's association names its author: the sender's only when they wrote it.
        association: author !== undefined && author.toLowerCase() === senderLogin.toLowerCase() ? subject.author_association : undefined,
        title: `${what} #${number} ${words}: ${str(subject.title) ?? ""}`,
        text: action === "opened" ? body : "",
        labels: labelsOf(subject),
        url: str(subject.html_url) ?? "",
        closes: action === "closed",
        addressed: asks(assignee, reviewer) || (action === "opened" && mentionsAgent(body))
      });
    }
    default:
      return [];
  }
}
