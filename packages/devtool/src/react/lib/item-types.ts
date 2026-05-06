/**
 * DevTool item union. Re-export of the canonical `RuntimeItem` so devtool
 * component switches can narrow on the four trace types as well as the
 * public production types.
 */
export type { RuntimeItem as DevtoolItem } from "@flow-state-dev/core/items/internal";
