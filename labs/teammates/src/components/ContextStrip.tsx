import type { LabHarness, LabContext } from "../adapter";
import { HarnessReadiness } from "./flow-state/harness-readiness";
import { harnessName } from "../lib/harness";

/**
 * What the lab works on and with, over the conversation (FIX-2403): the working
 * folder, the model, the default harness, and which coding harnesses can run
 * here, with Re-check. A folder whose checkout a coding run would refuse shows
 * that problem as a warning. Every value is the server's, read through the
 * lab's `lab-context` and `harness-readiness` flows.
 */
export function ContextStrip({
  context,
  harnesses,
  onRecheck,
}: {
  context: LabContext | undefined;
  harnesses: LabHarness[] | undefined;
  onRecheck: () => Promise<unknown>;
}) {
  const chip = "rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground";
  return (
    <section aria-label="Working context" className="flex flex-col gap-1 border-b border-border px-6 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {context === undefined ? (
          <span className="text-[11px] text-muted-foreground">Reading the lab's settings…</span>
        ) : (
          <>
            <span className={chip} data-testid="context-folder" title="The working folder: every coding task works in a worktree of it">
              folder {context.folder}
            </span>
            <span className={chip} data-testid="context-model" title="The model the teammates answer on">
              model {context.model}
            </span>
            <span className={chip} data-testid="context-harness" title="The harness a coding worker whose file names none runs on">
              default harness {harnessName(context.harness)}
            </span>
          </>
        )}
        <HarnessReadiness rows={harnesses} recheck={onRecheck} />
      </div>
      {context?.folderProblem == null ? null : (
        <p role="alert" className="text-[11px] text-destructive" data-testid="context-folder-problem">
          Coding tasks will fail here: {context.folderProblem}
        </p>
      )}
    </section>
  );
}
