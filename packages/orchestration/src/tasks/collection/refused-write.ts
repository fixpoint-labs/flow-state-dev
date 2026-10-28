/**
 * A write a collection refuses for a reason only it can name (FIX-2076).
 *
 * A ref that wraps a ledger with rules of its own (a session board that files
 * a worker's step for itself apart from its tasks for delegates) throws this
 * from the write it refuses. The task tools answer it as a soft error the model
 * can act on, `{ ok: false, error: "<code>: <message>" }`, the same way they
 * answer a creation cap. Nothing is written.
 */
export class TaskWriteRefusedError extends Error {
  /** A `snake_case` code the tool result leads with. */
  readonly code: string;
  /** The task the refused write named, when it named one. */
  readonly taskId?: string;

  /**
   * @param code The `snake_case` code, e.g. `"step_cannot_wait"`.
   * @param message What was refused and what to do instead, said to the model.
   * @param taskId The task the write named, when it named one.
   */
  constructor(code: string, message: string, taskId?: string) {
    super(message);
    this.name = "TaskWriteRefusedError";
    this.code = code;
    if (taskId !== undefined) this.taskId = taskId;
  }
}
