import { memo } from "react";
import type { SessionStep, StepRun } from "../adapter";
import { withToolState } from "./flow-state/tool-grouping";
import { cn } from "../lib/utils";

/**
 * A run of tool steps, drawn the same in the conversation and in a popup:
 * one step as its own line, several as one line ("Read 2 files and searched
 * the code") that opens to each. The run shows open while it is running and
 * folds once it isn't; opened or closed by hand, it stays so until its state
 * changes. A failed step says "(failed)" in words, in the lab's red.
 */
export const ToolRun = memo(function ToolRun({ steps, run }: { steps: readonly SessionStep[]; run: StepRun }) {
  const tone = run.state === "error" ? "text-destructive" : "text-muted-foreground";
  if (steps.length === 1) {
    return (
      <div data-step="tool" data-state={run.state} className={cn("text-xs", tone)}>
        <ToolText step={steps[0]!} />
      </div>
    );
  }
  return (
    <details open={run.open} data-step="tools" data-state={run.state} className="text-xs text-muted-foreground">
      <summary className={cn("cursor-pointer", tone)}>{run.label}</summary>
      <ol className="mt-1 pl-4">
        {steps.map((step) => (
          <li key={step.id} data-state={step.state} className={step.state === "error" ? "text-destructive" : undefined}>
            · <ToolText step={step} />
          </li>
        ))}
      </ol>
    </details>
  );
});

/** What one tool step did, with how it stands after it ("…", "(failed)"); a shell command is shown as the code it ran. */
function ToolText({ step }: { step: SessionStep }) {
  const state = withToolState("", step.state ?? "completed");
  return (
    <>
      {step.code ? <code className="font-mono">{step.text}</code> : step.text}
      {state === "" ? null : state === "…" ? state : ` ${state.trim()}`}
    </>
  );
}
