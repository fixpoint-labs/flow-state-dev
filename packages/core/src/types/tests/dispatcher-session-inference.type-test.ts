/**
 * Type-level tests for `dispatcher()`'s `{ key, link }` session: both
 * callbacks receive the input its `inputSchema` declares, with no annotation.
 *
 * Under `src/` so this package's `typecheck` (whose `include` is `src/**`)
 * checks it; vitest transpiles test files without checking types.
 */
import { z } from "zod";
import { dispatcher } from "../../blocks/dispatcher";

const input = z.object({ worker: z.string(), job: z.string() });

// `key` alone: `input` is the schema's output.
dispatcher({
  name: "keyed",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job }
});

// `key` with a `link` callback: both callbacks see the schema's output.
dispatcher({
  name: "linked",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job, link: (value) => value.worker }
});

// `link` as a fixed string.
dispatcher({
  name: "linked-fixed",
  action: "work",
  inputSchema: input,
  session: { key: (value) => value.job, link: "researcher" }
});

dispatcher({
  name: "linked-wrong-field",
  action: "work",
  inputSchema: input,
  // @ts-expect-error `nope` is not on the input
  session: { key: (value) => value.job, link: (value) => value.nope }
});
