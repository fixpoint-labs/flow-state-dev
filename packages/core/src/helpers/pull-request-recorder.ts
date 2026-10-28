/**
 * The pull-request recorder: reads every settled tool call of one request and
 * writes the pull requests a create call opened into the session's record
 * (`../types/pull-requests`).
 *
 * One recorder per request, with two entries:
 *
 * - {@link recordPullRequests} — a function a block calls. The Codex, Claude
 *   Code and Cursor blocks call it when they start, so harness runs record by
 *   default, and they stay handlers.
 * - {@link pullRequestRecorder} — a handler block a flow adds as a `.tap`
 *   step. It is how a flow with no harness (a generator holding a shell tool)
 *   records: the generator itself does not change.
 *
 * Either entry reads the items the request has emitted so far
 * (`ctx.response.getItems()`) and subscribes to the rest
 * (`ctx.response.subscribeToItems`), the one seam that sees harness and
 * generator tool calls alike. The recorder is keyed on the request's response,
 * so two harness blocks in a parallel step, or a harness run as a tool inside
 * a recording flow, share one listener. It stops in a request-end hook
 * (`onRequestEnded`), after it has written what it started, so no block's
 * return cuts another's recording short.
 *
 * A row is written as soon as its call settles, which is what lets an open
 * page show it mid-turn. A write that fails is a status note; it never fails
 * the run.
 */
import { handler } from "../blocks/handler";
import type { RuntimeItem } from "../items/internal";
import type { ResponseEmitterHandle } from "../types/block";
import { onRequestEnded } from "../types/request-end";
import {
  DEFAULT_PULL_REQUEST_RULES,
  OBSERVED_PULL_REQUESTS,
  findOpenedPullRequests,
  observedPullRequestsCollection,
  writePullRequests,
  type PullRequestCollection,
  type PullRequestRule,
} from "../types/pull-requests";

/** Options for {@link recordPullRequests} and {@link pullRequestRecorder}. */
export interface RecordPullRequestsOptions {
  /** The rules that read a create call. GitHub's by default. Only the request's first recorder's rules apply. */
  readonly rules?: readonly PullRequestRule[];
}

/**
 * What the recorder reads off a block's context: the request's id and item
 * stream, the flow's resources, and the status emitter. Any block's context
 * is one.
 */
export interface PullRequestRecorderContext {
  readonly request: { readonly identity: { readonly id: string } };
  readonly response: ResponseEmitterHandle;
  readonly resources?: unknown;
  readonly emit?: { status?(message: string, options?: { transient?: boolean }): unknown };
}

/** The running recorder of each request, by the request's response. */
const recorders = new WeakMap<object, true>();

/** The context's status-note emitter, when it has one. */
function note(ctx: PullRequestRecorderContext, message: string): void {
  try {
    ctx.emit?.status?.(message, { transient: false });
  } catch {
    // A note is a courtesy. The block it came from may have ended.
  }
}

/**
 * Start this request's pull-request recorder, once. Later calls in the same
 * request are no-ops. It stops when the request ends.
 *
 * Records nothing, and says so in a status note, when the flow has not
 * declared the {@link OBSERVED_PULL_REQUESTS} collection, or when the context
 * has no item subscription or no request-end seam (a hand-built context).
 */
export function recordPullRequests(ctx: PullRequestRecorderContext, options: RecordPullRequestsOptions = {}): void {
  const response = ctx.response as ResponseEmitterHandle | undefined;
  if (response === undefined || response === null || recorders.has(response)) return;
  const collection = (ctx.resources as Record<string, unknown> | undefined)?.[OBSERVED_PULL_REQUESTS] as
    | PullRequestCollection
    | undefined;
  if (typeof collection?.upsert !== "function" || typeof collection.getOptional !== "function") {
    note(ctx, `Pull requests are not being recorded: the "${OBSERVED_PULL_REQUESTS}" collection is not registered on this flow.`);
    return;
  }
  if (typeof response.subscribeToItems !== "function" || typeof response.getItems !== "function") {
    note(ctx, "Pull requests are not being recorded: this context has no item stream to read.");
    return;
  }

  const rules = options.rules ?? DEFAULT_PULL_REQUEST_RULES;
  const requestId = ctx.request.identity.id;
  const read = new Set<string>();
  // Writes run one after another, in the order the calls settled.
  let writes: Promise<void> = Promise.resolve();
  const take = (item: RuntimeItem): void => {
    if (item.type !== "tool_output" || read.has(item.id)) return;
    const refs = findOpenedPullRequests(item, rules);
    if (refs.length === 0) return;
    read.add(item.id);
    writes = writes.then(() =>
      writePullRequests(collection, refs, { source: "tool", requestId }).catch((err: unknown) => {
        note(ctx, `A pull request was not recorded: ${err instanceof Error ? err.message : String(err)}`);
      }),
    );
  };

  let unsubscribe: () => void = () => {};
  const stop = async (): Promise<void> => {
    unsubscribe();
    recorders.delete(response);
    await writes;
  };
  // Registered first: a context with no seam must not leave a listener behind.
  if (!onRequestEnded(ctx as never, stop)) {
    note(ctx, "Pull requests are not being recorded: this context has no request-end seam to stop the recorder at.");
    return;
  }
  recorders.set(response, true);
  for (const item of response.getItems()) take(item);
  unsubscribe = response.subscribeToItems((item) => take(item), {
    filter: (item) => item.type === "tool_output",
  });
}

/**
 * A handler block that records this request's pull requests: add it to a flow
 * with no harness as a `.tap` step. It declares the collection, reads the
 * request's items so far and starts the recorder for the rest. Tapped before
 * the generator, rows appear as each call settles; tapped after, when the step
 * runs.
 *
 * ```ts
 * sequencer({ name: "turn" })
 *   .tap(pullRequestRecorder())
 *   .step(assistant)
 * ```
 */
export function pullRequestRecorder(options: RecordPullRequestsOptions & { name?: string } = {}) {
  const { name = "pull-request-recorder", ...recordOptions } = options;
  return handler({
    name,
    description: "Records the pull requests this request's tool calls open, in the session's pull-request record.",
    resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection },
    execute: (_input: unknown, ctx): void => {
      recordPullRequests(ctx, recordOptions);
    },
  });
}
