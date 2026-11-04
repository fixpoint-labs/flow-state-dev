/**
 * Control `no-error-body`: the registry's `ErrorBody` draws nothing.
 *
 * Built into the control page in place of
 * `src/components/flow-state/error.tsx`, the copy the task frame's banner and
 * the Tasks row's line draw a failed task's error with. The goal must fail at
 * the failing row's **error** leg, on the frame and on its Tasks row.
 */
export * from "../../../../packages/shift-manager/src/components/flow-state/error.tsx";

export function ErrorBody(): null {
  return null;
}
