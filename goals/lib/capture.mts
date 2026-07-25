/**
 * Driving `fsdev run` and reading back what it captured.
 *
 * `fsdev run --capture <path>` writes `{ command, events, result }`. Reading it
 * correctly has one non-obvious rule, stated in the README (technique #4) and
 * previously ignored by both runners that consumed a capture:
 *
 *   TAKE THE LATEST SNAPSHOT OF EACH ITEM, NOT THE FIRST.
 *
 * Streamed assistant text is checkpointed into later item snapshots
 * (`content.delta` is not persisted as its own event), so filtering for
 * `item_added` and taking `e.item` yields the FIRST snapshot — which for a
 * streamed message is usually empty. Grading that produces a false FAIL. Both
 * capture-reading goals hedged around it by also grading `result.output`, which
 * masked the bug rather than fixing it. `readCapture` reduces by `item.id`
 * keeping the last snapshot, once, for everyone.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The `{ command, events, result }` document `fsdev run --capture` writes. */
export interface CaptureFile {
  command?: unknown;
  events?: CaptureEvent[];
  result?: CaptureResult;
}

/** One streamed event. Any event carrying an `item` contributes a snapshot. */
export interface CaptureEvent {
  type?: string;
  item?: CapturedItem;
  [key: string]: unknown;
}

/** An item snapshot. Shapes vary by item type; goals narrow as they need. */
export interface CapturedItem {
  id?: string;
  type?: string;
  role?: string;
  content?: unknown;
  text?: unknown;
  component?: string;
  [key: string]: unknown;
}

/** The action's terminal result. */
export interface CaptureResult {
  success?: boolean;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/** A parsed capture: the raw document plus the reconstructed final item list. */
export interface ParsedCapture {
  raw: CaptureFile;
  result: CaptureResult;
  /** Final state of each item — latest snapshot per id, in first-seen order. */
  items: CapturedItem[];
}

/** Options for {@link runFsdev}. */
export interface RunFsdevOptions {
  /** cwd for the child. `fsdev` config search is cwd-only, so this must be the app dir. */
  app: string;
  flow: string;
  action: string;
  /** Serialized to JSON for `-i`. Omit for actions taking no input (sends `{}`). */
  input?: unknown;
  /** `--model`. Omit to let the app's intent ladder decide (and record what ran). */
  model?: string;
  /** `--session`. */
  session?: string;
  /** `--capture` target path. */
  capture?: string;
  /** `--quiet`. */
  quiet?: boolean;
  /** Extra env for the child, merged over the parent's. */
  env?: Record<string, string>;
  /** Suppress child stdio (default false — goals show the run). */
  silent?: boolean;
}

/**
 * Run one `fsdev run <flow> <action>` and return its exit code.
 *
 * Returns rather than throws: a non-zero exit is data for several goals (a
 * clean refusal at a gate is a PASS for `gate-non-equity`), so the caller
 * decides what it means. This replaces five near-identical local `fsdev()`
 * wrappers that each re-derived the exit code from the thrown error.
 */
export function runFsdev(options: RunFsdevOptions): number {
  const args = ["fsdev", "run", options.flow, options.action];
  args.push("-i", JSON.stringify(options.input ?? {}));
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.session !== undefined) args.push("--session", options.session);
  if (options.capture !== undefined) args.push("--capture", options.capture);
  if (options.quiet === true) args.push("--quiet");

  try {
    execFileSync("pnpm", args, {
      cwd: options.app,
      stdio: options.silent === true ? "ignore" : "inherit",
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

/**
 * Read a capture file and reconstruct the final state of every item.
 *
 * Any event carrying `item.id` contributes a snapshot; the last one wins. Do
 * NOT filter to `item_added` — that is precisely the first-snapshot bug.
 */
export function readCapture(path: string): ParsedCapture {
  const raw = JSON.parse(readFileSync(path, "utf8")) as CaptureFile;
  const byId = new Map<string, CapturedItem>();
  for (const event of raw.events ?? []) {
    const id = event.item?.id;
    if (id !== undefined) byId.set(id, event.item as CapturedItem);
  }
  return { raw, result: raw.result ?? {}, items: [...byId.values()] };
}

/**
 * Pull the text out of a message item, whether its content is a bare string, an
 * array of content parts (`{ type, text }`), or a `text` field.
 */
export function messageText(item: CapturedItem | undefined): string {
  const content = item?.content ?? item?.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? "")))
      .join(" ");
  }
  return String(content);
}

/** Every assistant (non-user) message item in the capture. */
export function assistantMessages(items: CapturedItem[]): CapturedItem[] {
  return items.filter((item) => item.type === "message" && item.role !== "user");
}

/** The assistant messages' text, newline-joined. */
export function assistantText(items: CapturedItem[]): string {
  return assistantMessages(items).map(messageText).join("\n");
}

/**
 * The full user-visible answer surface: assistant message text plus the
 * action's returned output. This is what a content assertion should grade —
 * asserting on either alone is what made the first-snapshot bug invisible.
 */
export function answerText(capture: ParsedCapture): string {
  return `${assistantText(capture.items)}\n${String(capture.result.output ?? "")}`.trim();
}

/** The model the assistant generator actually ran on, if the capture records it. */
export function actualModel(items: CapturedItem[]): string {
  const found = assistantMessages(items)
    .map((message) => (message as { model?: { actual?: string } }).model?.actual)
    .find(Boolean);
  return found ?? "unknown";
}
