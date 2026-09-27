/**
 * Compile-time half of the browser entry's export check: the one name
 * `@flow-state-dev/workforce/browser` exports that has no runtime value.
 *
 * `browser-subpath-safe.test.ts` pins the five runtime exports, but vitest
 * strips types, so dropping `ChannelTranscriptLine` from the entry would pass
 * it. `tsconfig.test-d.json` compiles this file under `pnpm typecheck`; remove
 * the export and the import below fails to compile.
 */
import { expectTypeOf } from "vitest";
import type { ChannelTranscriptLine, channelTranscriptLineSchema } from "../src/browser";

expectTypeOf<ChannelTranscriptLine>().toEqualTypeOf<
  ReturnType<typeof channelTranscriptLineSchema.parse>
>();
