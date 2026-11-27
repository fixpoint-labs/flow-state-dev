/**
 * Three dots that rise in turn: something is happening. They mark the turn
 * still running at the end of the thread. A task's feed ends in the registry's
 * `StreamingIndicator` instead. The motion is in `styles.css` and stops under
 * *reduce motion*.
 */
export function WorkingDots() {
  return (
    <span aria-hidden className="working-dots flex shrink-0 items-center gap-1">
      <span className="size-1.5 rounded-full bg-info" />
      <span className="size-1.5 rounded-full bg-info" />
      <span className="size-1.5 rounded-full bg-info" />
    </span>
  );
}
