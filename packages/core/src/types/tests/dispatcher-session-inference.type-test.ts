/**
 * Type-level tests for `dispatcher()`'s `{ key, state }` session: both
 * callbacks receive the input its `inputSchema` declares, with no annotation.
 *
 * Under `src/` so this package's `typecheck` (whose `include` is `src/**`)
 * checks it; vitest transpiles test files without checking types.
 */
import { z } from "zod";
import { dispatcher } from "../../blocks/dispatcher";

const input = z.object({ project: z.string(), job: z.string() });

// `key` alone: `input` is the schema's output.
dispatcher({
  name: "keyed",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job }
});

// `key` with a `state` callback: both callbacks see the schema's output.
dispatcher({
  name: "with-state",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job, state: (value) => ({ projectId: value.project }) }
});

// `state` as a fixed object.
dispatcher({
  name: "with-fixed-state",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job, state: { projectId: "p1" } }
});

dispatcher({
  name: "with-state-wrong-field",
  action: "work",
  inputSchema: input,
  // @ts-expect-error `nope` is not on the input
  session: { key: (value) => value.job, state: (value) => ({ projectId: value.nope }) }
});
