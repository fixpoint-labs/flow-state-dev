/**
 * What a coding harness mode's address shows: its frame when the mode can run
 * on this host, with the mode's note when it has one, and otherwise the picker's reason with a link back, and
 * nothing else. No rail, no composer, no session is drawn or created for an
 * unavailable mode, wherever it was reached from.
 *
 * A server component. Each harness address (`app/claude-code`, `app/codex`,
 * `app/cursor`) renders it on every request from the same once-per-start
 * answer the picker reads. It also works out, per request, the header line
 * each session shows about what its harness loads from the repository.
 */
import Link from "next/link";

import { HarnessModeView } from "@/components/harness-mode-view";
import { claudeCodeRepoLine } from "@/lib/claude-code-mode";
import { codexRepoLine } from "@/lib/codex-mode";
import { cursorRepoLine } from "@/lib/cursor-mode";
import { modeAvailability } from "@/lib/harness-gate";
import type { RepoLine } from "@/lib/harness-trust";
import { harnessModelChoices } from "@/lib/harness-models";
import { flowKindOf, modeById, type HarnessModeId } from "@/lib/modes";

/** Each harness mode's header line, from the same options its runs are built with. */
const REPO_LINES: Record<HarnessModeId, () => RepoLine> = {
  "claude-code": () => claudeCodeRepoLine(),
  codex: () => codexRepoLine(),
  cursor: () => cursorRepoLine(),
};

/** The page for the harness mode `id`. */
export async function HarnessModePage({ id }: { id: HarnessModeId }) {
  const mode = modeById(id);
  const availability = (await modeAvailability())[id];
  // Trusted: the gate makes a harness mode available only once it has a flow kind.
  if (availability.available) {
    // Asked on each request, so a list that couldn't be read is asked for again.
    const models = await harnessModelChoices(id);
    return (
      <HarnessModeView
        label={mode.label}
        flowKind={flowKindOf(mode)}
        note={availability.note}
        models={models}
        repoLine={REPO_LINES[id]()}
      />
    );
  }
  const reason = availability.reason;
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-10 sm:px-6" data-testid="mode-unavailable" data-mode-id={id}>
      <div className="mx-auto max-w-xl">
        <h1 className="text-xl font-semibold">{mode.label} is unavailable here</h1>
        <p className="mt-2 break-words text-sm" data-testid="mode-reason">
          {reason}
        </p>
        <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">
          Back to the modes
        </Link>
      </div>
    </main>
  );
}
