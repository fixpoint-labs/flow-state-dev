/**
 * Built-in command registry for `fsdev chat`. Built-ins are plain in-CLI handlers
 * (`/help`, `/targets`, `/use`, `/status`, `/session`, `/exit`) that mutate
 * `HarnessState` and print through the injected `write`. Pure of transport: the
 * loop injects the runtime snapshot, session-guard callback, and writer, so the
 * registry never touches stores directly (tests stub those).
 */
import { pickTarget, type FlowActionTarget } from "./targets";
import { type HarnessState, bindTarget, newSessionId, activeSessionId } from "./state";

export interface BuiltinCommand {
  /** The command verb, without the leading slash. */
  name: string;
  /** One-line description for `/help`. */
  summary: string;
  /** Usage hint, e.g. `/use <flow> [action]`. */
  usage: string;
  run(args: string, ctx: BuiltinContext): Promise<BuiltinResult>;
}

export interface BuiltinContext {
  state: HarnessState;
  /** All resolvable targets, for enumeration and `/use` validation. */
  targets: FlowActionTarget[];
  /**
   * Plain-data runtime snapshot computed once by the loop wiring — no live
   * handles. `/status` renders these lines verbatim.
   */
  runtime: { source: string; store: string };
  /**
   * Runs the session guard (record flow-kind + history scan) against the active
   * stores/identity, so `/session <id>` can enforce it while this module stays
   * store-free. Injected by the loop wiring; stubbed in unit specs.
   */
  validateSessionForTarget(
    sessionId: string,
    target: FlowActionTarget,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Emit a line of system output (wired to the renderer's `onSystem`). */
  write(line: string): void;
}

export type BuiltinResult = { ok: true; exit?: boolean } | { ok: false; message: string };

/** True when two targets address the same flow action. */
function sameTarget(a: FlowActionTarget | undefined, b: FlowActionTarget): boolean {
  return a !== undefined && a.flowKind === b.flowKind && a.actionName === b.actionName;
}

const help: BuiltinCommand = {
  name: "help",
  summary: "list commands",
  usage: "/help",
  run: async (_args, ctx) => {
    ctx.write("Commands:");
    for (const command of ORDERED) {
      ctx.write(`  ${command.usage.padEnd(22)} ${command.summary}`);
    }
    ctx.write("Anything else after / is sent to the flow — that's how skills are invoked.");
    return { ok: true };
  },
};

const targets: BuiltinCommand = {
  name: "targets",
  summary: "list available flow · action targets",
  usage: "/targets",
  run: async (_args, ctx) => {
    if (ctx.targets.length === 0) {
      ctx.write("No targets available.");
      return { ok: true };
    }
    ctx.write("Targets:");
    for (const target of ctx.targets) {
      const marker = sameTarget(ctx.state.defaultTarget, target) ? "*" : " ";
      ctx.write(`  ${marker} ${target.flowKind} · ${target.actionName}`);
    }
    return { ok: true };
  },
};

const use: BuiltinCommand = {
  name: "use",
  summary: "switch the default target",
  usage: "/use <flow> [action]",
  run: async (args, ctx) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { ok: false, message: "usage: /use <flow> [action]" };

    const picked = pickTarget(ctx.targets, parts[0]!, parts[1]);
    if (!picked.ok) {
      switch (picked.reason) {
        case "unknown-flow":
          return { ok: false, message: `Unknown flow "${picked.flowKind}". Available: ${picked.available.join(", ") || "(none)"}` };
        case "unknown-action":
          return { ok: false, message: `Flow "${picked.flowKind}" has no action "${picked.actionName}". Actions: ${picked.actions.join(", ")}` };
        case "ambiguous":
          return { ok: false, message: `Flow "${picked.flowKind}" has multiple actions: ${picked.actions.join(", ")}. Pick one: /use ${picked.flowKind} <action>` };
      }
    }

    const { sessionId, fresh } = bindTarget(ctx.state, picked.target);
    ctx.write(`Now chatting with ${picked.target.flowKind} · ${picked.target.actionName} (session ${sessionId}, ${fresh ? "new" : "resumed"}).`);
    return { ok: true };
  },
};

const status: BuiltinCommand = {
  name: "status",
  summary: "show target, session, turns, and runtime",
  usage: "/status",
  run: async (_args, ctx) => {
    const target = ctx.state.defaultTarget;
    ctx.write(target ? `Target:  ${target.flowKind} · ${target.actionName}` : "Target:  (none — /use <flow> to bind)");
    ctx.write(`Session: ${activeSessionId(ctx.state) ?? "(none)"}`);
    ctx.write(`Turns:   ${ctx.state.turns}`);
    ctx.write(`Source:  ${ctx.runtime.source}`);
    ctx.write(`Store:   ${ctx.runtime.store}`);
    return { ok: true };
  },
};

const session: BuiltinCommand = {
  name: "session",
  summary: "print, rotate (new), or bind (<id>) the current flow's session",
  usage: "/session [new|<id>]",
  run: async (args, ctx) => {
    const target = ctx.state.defaultTarget;
    if (target === undefined) return { ok: false, message: "No target bound. Use /use <flow> first." };

    const arg = args.trim();
    if (arg === "") {
      ctx.write(`Session: ${activeSessionId(ctx.state) ?? "(none)"}`);
      return { ok: true };
    }
    if (arg === "new") {
      const sessionId = newSessionId();
      ctx.state.sessions.set(target.flowKind, sessionId);
      ctx.write(`New session: ${sessionId} (history reset).`);
      return { ok: true };
    }

    // Bind an explicit id, subject to the session guard. A nonexistent id is
    // allowed — the engine creates the record on the first turn.
    const verdict = await ctx.validateSessionForTarget(arg, target);
    if (!verdict.ok) return { ok: false, message: verdict.message };
    ctx.state.sessions.set(target.flowKind, arg);
    ctx.write(`Bound session: ${arg}.`);
    return { ok: true };
  },
};

const exit: BuiltinCommand = {
  name: "exit",
  summary: "leave the chat session",
  usage: "/exit",
  run: async () => ({ ok: true, exit: true }),
};

/** Built-ins in `/help` display order. */
const ORDERED: readonly BuiltinCommand[] = [help, targets, use, status, session, exit];

/** Build the immutable built-in command registry keyed by verb. */
export function createBuiltinRegistry(): ReadonlyMap<string, BuiltinCommand> {
  return new Map(ORDERED.map((command) => [command.name, command]));
}
