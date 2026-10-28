/**
 * Waiting for a user (FIX-2129, ER-1): the one call a block makes when its
 * code reads a person's answer on its next line.
 *
 *   const asked = await ctx.waitForUser({ kind: "input", prompt: "Which region?", deadline: 2 * DAY });
 *   if (asked.cancelled) return { skipped: true };
 *   const region = asked.answer;
 *
 * It is `ctx.suspend` with a kind, a deadline and a cancel, so it needs
 * durable execution as `ctx.suspend` does. Three kinds:
 *
 * - `approval`: a yes or a no. At its deadline it reads as a no marked
 *   `deadline: true`.
 * - `review`: a verdict on work the user looks at.
 * - `input`: an answer.
 *
 * At a review's or an input's deadline the call throws
 * `SuspensionTimeoutError`, which the block may catch to go ahead, end or
 * ask again; left uncaught it fails the try (D1). A stop with no deadline
 * waits until it is answered, stopped or cancelled: the call's `deadline`,
 * else the host's setting for a user's stop (`RequestHost.userDeadlineMs`),
 * else none (epic D3).
 *
 * When the task the request works is cancelled while it waits, the call
 * returns `{ cancelled: true }` and the block runs to its end; nothing it
 * writes to the task, and nothing it returns, is kept. Any later wait for a
 * user in that run is cancelled at once.
 *
 * A question the work can go on without is not this: it holds its task
 * (FIX-2133).
 */
import type { ZodTypeAny } from "zod";
import { SuspensionRejectedError, SuspensionTimeoutError, type SuspendOptions } from "../errors/suspension-error";
import type { WaitForUserKind } from "./suspension";

/** What {@link WaitForUser} takes. */
export interface WaitForUserOptions<K extends WaitForUserKind = WaitForUserKind> {
  /** What the stop asks for. */
  readonly kind: K;
  /** What the user is asked, shown where they answer it. May be markdown. */
  readonly prompt: string;
  /** A short heading, a few words, when the prompt is longer than one line. */
  readonly title?: string;
  /**
   * How long the stop waits, in milliseconds from the call. Omit it and the
   * host's setting for a user's stop applies; with none, it waits until
   * answered, stopped or cancelled.
   */
  readonly deadline?: number;
  /**
   * The shape of the answer, checked when it is given (a Zod schema or a
   * JSON Schema). For an approval it checks the optional data sent with a yes.
   */
  readonly resumeSchema?: ZodTypeAny | Record<string, unknown>;
  /** Context the screen shows beside the prompt. */
  readonly data?: Record<string, unknown>;
  /** A component a screen renders the stop with. */
  readonly render?: { component: string; props?: Record<string, unknown> };
}

/** The task was cancelled while the stop waited: nobody answered. */
export type WaitForUserCancelled = { readonly cancelled: true };

/**
 * How an approval came back: a yes (with any data sent with it), a no, or
 * cancelled. A no at the stop's deadline carries `deadline: true`.
 */
export type ApprovalAnswer =
  | WaitForUserCancelled
  | { readonly cancelled: false; readonly approved: true; readonly answer?: unknown }
  | { readonly cancelled: false; readonly approved: false; readonly deadline: boolean; readonly answer?: unknown };

/** How a review or an input came back: the answer, or cancelled. */
export type UserAnswer<T = unknown> = WaitForUserCancelled | { readonly cancelled: false; readonly answer: T };

/** `ctx.waitForUser`: stop the request until the user answers (see the module header). */
export interface WaitForUser {
  (options: WaitForUserOptions<"approval">): Promise<ApprovalAnswer>;
  <T = unknown>(options: WaitForUserOptions<"review" | "input">): Promise<UserAnswer<T>>;
}

/** What {@link waitForUserOn} reads off the context. */
export interface WaitForUserContext {
  suspend?(options: SuspendOptions): Promise<unknown>;
  readonly requestHost?: { readonly userDeadlineMs?: number };
}

/** The suspension one wait for a user is. */
function suspendOptionsOf(options: WaitForUserOptions, deadline: number | undefined): SuspendOptions {
  const approval = options.kind === "approval";
  return {
    reason: approval ? "user_approval" : "user_input",
    kind: options.kind,
    message: options.prompt,
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.resumeSchema !== undefined ? { resumeSchema: options.resumeSchema } : {}),
    ...(options.render !== undefined ? { render: options.render } : {}),
    ...(deadline !== undefined ? { timeoutMs: deadline } : {}),
    allow: approval ? ["approve", "reject"] : ["submit"]
  };
}

/** The deadline a call waits for: its own, else the host's, else none. */
function deadlineOf(ctx: WaitForUserContext, options: WaitForUserOptions): number | undefined {
  const deadline = options.deadline ?? ctx.requestHost?.userDeadlineMs;
  if (deadline === undefined) return undefined;
  if (!Number.isFinite(deadline) || deadline <= 0) {
    throw new TypeError(`waitForUser: deadline must be a positive number of milliseconds, got ${String(deadline)}`);
  }
  return deadline;
}

/**
 * Wait for a user on `ctx`: the body of `ctx.waitForUser`, which the runtime
 * binds to each block's context.
 *
 * @throws {SuspensionTimeoutError} At a review's or an input's deadline.
 * @throws When the host has no durable execution, as `ctx.suspend` does.
 */
export async function waitForUserOn(ctx: WaitForUserContext, options: WaitForUserOptions): Promise<ApprovalAnswer | UserAnswer> {
  if (ctx.suspend === undefined) throw new Error("waitForUser needs ctx.suspend, which only a durable host provides.");
  const suspendOptions = suspendOptionsOf(options, deadlineOf(ctx, options));
  try {
    const answer = await ctx.suspend(suspendOptions);
    return options.kind === "approval" ? { cancelled: false, approved: true, answer } : { cancelled: false, answer };
  } catch (error) {
    if (!(error instanceof SuspensionRejectedError)) throw error;
    if (error.cancelled) return { cancelled: true };
    if (options.kind === "approval") {
      return { cancelled: false, approved: false, deadline: error.expired, answer: error.rejectionData };
    }
    // A review or an input has no no: its only ending without an answer is the deadline.
    throw new SuspensionTimeoutError(error.suspensionId);
  }
}
