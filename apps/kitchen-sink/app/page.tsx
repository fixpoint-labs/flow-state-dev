/**
 * The front page: a picker of Kitchen Sink's modes. Each mode says whether it
 * can run on this host, and an available one opens at its own address.
 *
 * A server component, rendered on every request rather than at build: the
 * answer comes from `modeAvailability()`, decided once when the server starts,
 * so one build shows the right answer on a laptop and on a deployed copy. The
 * picker remembers nothing; `/` always shows every mode.
 */
import Link from "next/link";

import { modeAvailability, type ModeAvailability } from "@/lib/harness-gate";
import { MODES, type KitchenSinkMode } from "@/lib/modes";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

/** What each mode is, in a line. */
const BLURBS: Record<KitchenSinkMode["id"], string> = {
  "flow-state": "The framework's own flows: the assistant, and the support desk with its team.",
  "claude-code": "Claude Code, run as a coding harness on a repository.",
  codex: "Codex, run as a coding harness on a repository.",
  cursor: "Cursor's agent, run as a coding harness on a repository.",
};

export default async function PickerPage() {
  const availability = await modeAvailability();
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Kitchen Sink</h1>
          <ThemeToggle />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Pick a mode.</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="mode-picker">
          {MODES.map((mode) => (
            <ModeCard key={mode.id} mode={mode} availability={availability[mode.id]} />
          ))}
        </ul>
      </div>
    </main>
  );
}

function ModeCard({ mode, availability }: { mode: KitchenSinkMode; availability: ModeAvailability }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{mode.label}</span>
        <span
          className={
            availability.available
              ? "rounded bg-success/15 px-1.5 py-0.5 text-xs text-success"
              : "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          }
        >
          {availability.available ? "Available" : "Unavailable"}
        </span>
      </span>
      <span className="mt-1 block text-sm text-muted-foreground">{BLURBS[mode.id]}</span>
      {!availability.available && (
        <span className="mt-2 block break-words text-sm" data-testid="mode-reason">
          {availability.reason}
        </span>
      )}
      {availability.available && availability.note !== undefined && (
        <span className="mt-2 block break-words text-sm" data-testid="mode-note">
          {availability.note}
        </span>
      )}
    </>
  );
  return (
    <li data-mode-id={mode.id} data-available={availability.available ? "true" : "false"}>
      {availability.available ? (
        <Link href={mode.href} className="block h-full rounded-lg border p-4 hover:bg-accent/50">
          {body}
        </Link>
      ) : (
        <div className="block h-full rounded-lg border border-dashed p-4" aria-disabled="true">
          {body}
        </div>
      )}
    </li>
  );
}
