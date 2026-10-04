/**
 * Compile-time half of the browser entry's export check: the one name
 * `@flow-state-dev/workforce/browser` exports that has no runtime value.
 *
 * `browser-subpath-safe.test.ts` pins the runtime exports, but vitest
 * strips types, so dropping `MailboxTranscriptLine` from the entry would pass
 * it. `tsconfig.test-d.json` compiles this file under `pnpm typecheck`; remove
 * the export and the import below fails to compile.
 */
import { expectTypeOf } from "vitest";
import type { MailboxTranscriptLine, mailboxTranscriptLineSchema } from "../src/browser";

expectTypeOf<MailboxTranscriptLine>().toEqualTypeOf<
  ReturnType<typeof mailboxTranscriptLineSchema.parse>
>();
