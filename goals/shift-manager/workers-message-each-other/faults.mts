/**
 * Leg 9's faults (FIX-2240). Each is a scratch patch applied as the server
 * loads, through the same `goals/lib/module-patch.mjs` the controls use, and
 * each appends a line to the run's fault log (`GOAL_FAULT_LOG`) when it fires,
 * so a sub-leg whose fault never fired is a setup failure, not a grade.
 *
 * Every fault touches only the herald's messages, so the rest of the install
 * runs as shipped. Fault patches keep the line they anchor on, so a control
 * patching the same line still finds it: the runner applies the faults first.
 */
import { existsSync, readFileSync } from "node:fs";
import type { ModulePatch } from "../../lib/module-patch.mts";

export const FAULT_NAMES = ["exit-after-row", "fast-path-throws", "lose-first-take", "late-copy", "hold-resend", "exit-after-take"] as const;
export type FaultName = (typeof FAULT_NAMES)[number];

const MESSAGES = "packages/workforce/src/messages";
const ENTRY = `${MESSAGES}/message-received-entry.ts`;
const SEND = `${MESSAGES}/send-message.ts`;
const DELIVERY = `${MESSAGES}/delivery.ts`;

/** The block name the late copy is dispatched from, so its request record says it is the copy. */
export const LATE_COPY_FROM = "goal-late-copy";

/** The JavaScript that appends one fault-log line: `detail` is an object expression. */
const log = (fault: FaultName, detail: string) =>
  `process.getBuiltinModule("node:fs").appendFileSync(process.env.GOAL_FAULT_LOG, JSON.stringify({ fault: "${fault}", ...(${detail}), at: Date.now() }) + "\\n");`;

export const FAULTS: Record<FaultName, { does: string; patches: ModulePatch[] }> = {
  "exit-after-row": {
    does: "the process kills itself after the herald's send writes the row, before the dispatch",
    patches: [
      {
        module: SEND,
        from: String.raw`const ref = await log\.getOrCreate\(id, row\);`,
        to: `$& if (row.from === "herald") { ${log("exit-after-row", "{ id, request: ctx.request.identity.id, session: ctx.session.identity.id }")} process.exit(1); }`,
      },
    ],
  },
  "fast-path-throws": {
    does: "the herald's send's own dispatch throws before sending; the pass's resends go out",
    patches: [
      {
        module: SEND,
        from: String.raw`outcome = await dispatchMessage\(ctx, row, from\);`,
        to: `if (row.from === "herald") { ${log("fast-path-throws", "{ id: row.id, request: ctx.request.identity.id }")} throw new Error("goal fault: the send's own dispatch threw"); } $&`,
      },
    ],
  },
  "lose-first-take": {
    does: "the first request each of the herald's messages starts ends before its take, as a queued request the host stopped would",
    patches: [
      {
        module: ENTRY,
        from: String.raw`const row = await takeMessage\(ctx(?: as never)?, input\.messageId\);`,
        to:
          'const __lostRow = (await (await import("./message-log")).messageLogOf(ctx).getOptional(input.messageId))?.state; ' +
          'if (__lostRow?.from === "herald") { const __lost = (globalThis.__goalLoseFirst ??= new Set()); ' +
          `if (!__lost.has(input.messageId)) { __lost.add(input.messageId); ${log("lose-first-take", "{ id: input.messageId, request: ctx.request.identity.id }")} return { act: "none" }; } } $&`,
      },
    ],
  },
  "late-copy": {
    does: "each of the herald's messages is dispatched once more after the next one to the same session lands",
    patches: [
      {
        module: ENTRY,
        from: String.raw`await markDelivered\(ctx(?: as never)?, row\.id\);`,
        to:
          '$& if (row.from === "herald") { const __copies = (globalThis.__goalLateCopy ??= new Map()); const __prev = __copies.get(row.toSession); __copies.set(row.toSession, row); ' +
          `if (__prev !== undefined && __prev.id !== row.id) { ${log("late-copy", "{ id: __prev.id, after: row.id, session: row.toSession }")} ` +
          `await (await import("./delivery")).dispatchMessage(ctx, __prev, "${LATE_COPY_FROM}"); } }`,
      },
    ],
  },
  "hold-resend": {
    does: "the pass holds every resend of the herald's messages, before its recipient check, until the runner writes the release file",
    patches: [
      {
        module: DELIVERY,
        from: String.raw`const refusal = await recheck\(ctx, ref\.state\);`,
        to:
          'if (ref.state.from === "herald" && !process.getBuiltinModule("node:fs").existsSync(process.env.GOAL_FAULT_RELEASE ?? "")) { ' +
          `const __held = (globalThis.__goalHeld ??= new Set()); if (!__held.has(entry.id)) { __held.add(entry.id); ${log("hold-resend", "{ id: entry.id }")} } ` +
          "later(Date.now() + 2000); continue; } $&",
      },
    ],
  },
  "exit-after-take": {
    does: "the process kills itself after Helper B's request takes a herald message, before its items",
    patches: [
      {
        module: ENTRY,
        from: String.raw`if \(row === undefined\) return \{ act: "none" \};`,
        to: `$& if (row.from === "herald") { ${log("exit-after-take", "{ id: row.id, request: ctx.request.identity.id }")} process.exit(1); }`,
      },
    ],
  },
};

/** The patches for `faults`, in order. */
export function faultPatches(faults: readonly FaultName[]): ModulePatch[] {
  return faults.flatMap((f) => FAULTS[f].patches);
}

/** One line of the fault log. */
export interface FaultLine {
  fault: FaultName;
  id: string;
  at: number;
  request?: string;
  session?: string;
  after?: string;
}

/** The fault log's lines, oldest first. */
export function faultLines(path: string): FaultLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FaultLine);
}
