/**
 * Runs inside the consumer project for `types.typed-handler`: an adopter's
 * handler that declares `uses: [cap]` hands its own `ctx`, with no cast, to
 * `getOrCreateTaskCollection` from `@flow-state-dev/orchestration/tasks`, a
 * helper typed `BlockContext` on a public entry, and the file compiles under
 * `strict` against the INSTALLED declarations.
 *
 * A handler with scope state schemas alone already compiles on the control, so
 * the probe declares a capability: that is the case that needed `ctx as never`.
 * Two guards keep a pass honest: the handler's `ctx` and the helper's `ctx`
 * parameter must not be `any` (a missing or loosened declaration would let
 * anything compile), and the probe below carries no `as` and no `@ts-`
 * directive: keep it that way.
 *
 * Prints `typed-handler: ok`, or `typed-handler: FAIL at compile: <n>
 * diagnostic(s)` followed by one indented line per diagnostic. Anything else
 * (TypeScript missing, a crash) is the harness's `error`.
 */
import { writeFileSync } from "node:fs";
import ts from "typescript";

const probe = "goal-typed-handler.probe.ts";
const source = `import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration/tasks";

type IsAny<T> = 0 extends 1 & T ? true : false;
type HelperCtx = Parameters<typeof getOrCreateTaskCollection>[0]["ctx"];
const helperCtxIsTyped: IsAny<HelperCtx> = false;

const notes = defineCapability({
  name: "goal-notes",
  sessionStateSchema: z.object({ seen: z.number().default(0) }),
});

export const plan = handler({
  name: "goal-plan",
  inputSchema: z.object({ title: z.string() }),
  outputSchema: z.object({ count: z.number() }),
  uses: [notes],
  execute: async (input, ctx) => {
    const ctxIsTyped: IsAny<typeof ctx> = false;
    const tasks = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "goal-plan" });
    void tasks;
    void ctxIsTyped;
    return { count: input.title.length };
  },
});

export { helperCtxIsTyped };
`;
writeFileSync(probe, source);

const program = ts.createProgram([probe], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
});
const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(probe));
if (diagnostics.length === 0) {
  console.log("typed-handler: ok");
} else {
  console.log(`typed-handler: FAIL at compile: ${diagnostics.length} diagnostic(s)`);
  for (const d of diagnostics) {
    const at = d.file && d.start != null ? `${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : "";
    const text = ts.flattenDiagnosticMessageText(d.messageText, " ").replace(/\s+/g, " ");
    // The reason sits at the end of a long assignability chain: keep both ends.
    const short = text.length > 500 ? `${text.slice(0, 150)} … ${text.slice(-350)}` : text;
    console.log(`  ${at}TS${d.code} ${short}`);
  }
}
