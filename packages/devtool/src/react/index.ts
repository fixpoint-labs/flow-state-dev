/**
 * Public entry for `@flow-state-dev/devtool/react` — the embeddable
 * `<DevToolPanel />` component plus the helpers a host needs to construct
 * its own initial config (e.g. read the standalone shell's persisted userId
 * from localStorage).
 */
export { DevToolPanel, type DevToolPanelProps } from "./DevToolPanel";
export { type UserIdControl } from "./context/devtool-context";
export { type DevToolConfig } from "./lib/client";
export { readUserId, writeUserId } from "./config";
