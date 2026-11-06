/**
 * Entry for `@flow-state-dev/core/blocks/sequencer`: the `sequencer` builder,
 * without the root's Node built-ins, so a module that bundles for a browser can
 * build a sequencer. The rest of `./sequencer` is runtime plumbing and stays
 * off this subpath.
 */
export { sequencer } from "./sequencer";
