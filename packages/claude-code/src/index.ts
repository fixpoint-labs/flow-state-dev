/**
 * `@flow-state-dev/claude-code` package root.
 *
 * Exposes only the source-agnostic handle envelope shared by the entry
 * points. Import the dispatch surface from `@flow-state-dev/claude-code/cli`;
 * the in-process Agent SDK surface will live at `@flow-state-dev/claude-code/sdk`.
 */
export * from "./shared";
