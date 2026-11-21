/**
 * `@flow-state-dev/react/internal`: seams the framework's own packages share,
 * such as the DevTool's read fence, Shift Manager's suspension reduction, and
 * the words a failed read is shown in.
 * Not a public API, and no app should import it: an app reads through the
 * documented hooks.
 *
 * @internal
 */
export { useReadFence, type ReadFence } from "./hooks/useReadFence";
export { deriveSuspensions } from "./hooks/useSuspensions";
// FIX-2627: what workforce's components (`@flow-state-dev/workforce/react`) read through.
export { useClient } from "./internal/useClient";
export { useFencedRead, type ReadDriver } from "./internal/useFencedRead";
// FIX-2775: the one rule for a failed read's words, so a write's refusal reads as `useView`'s and `useResource`'s `failure` does.
export { failureOf, type ViewReadFailure } from "./internal/readFailure";
