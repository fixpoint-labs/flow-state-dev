/**
 * `@flow-state-dev/workforce/codegen` — turn an app's code folders into a module.
 *
 * The convention's other half. Where `./loader` reads the Markdown that
 * describes a team, this reads the **tree** under `workforce/flows/workers/`,
 * `workforce/flows/channels/` and `workforce/blocks/` and renders one module of
 * static imports: `kinds`, `channelKinds` and `blocks`, each feeding a parameter
 * the framework already takes. `fsdev gen` is a thin command over these two
 * calls — it resolves the root, writes the file, and prints what it found.
 *
 * Discovery is a build step on purpose. The same walk done by a running
 * framework works on a Node host and finds nothing on a bundled one, because
 * after a Next or Vercel build those files are no longer separate modules. What
 * this emits is static imports, which every bundler already resolves, so the
 * result is identical on both.
 *
 * Nothing here loads a discovered module, and nothing in a shipped package
 * imports a path it discovered. Kept behind a subpath so importing the package
 * root does not pull a consumer onto `node:fs`.
 */

export {
  CODE_SLOTS,
  WorkforceCodeError,
  discoverWorkforceCode,
  type CodeSlot,
  type CodeSlotId,
  type DiscoveredFile,
  type DiscoveryResult,
} from "./discover";

export { GENERATED_FILE_NAME, renderWorkforceCode } from "./render";
