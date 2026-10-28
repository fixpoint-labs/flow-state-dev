/**
 * A roster worker's settings (`/roster/<workerId>/settings`, FIX-2007).
 * `/roster/<workerId>/rules` still opens it. A flow that keeps no rules gets a
 * line here, not an empty list (BR-21a).
 */
import { StandingRules } from "../components/StandingRules";
import { ScreenTitle } from "../components/ui";
import { shiftCoordinatorOf, type LoadedSnapshot } from "../lib/derive";
import { useRoster, withRoster } from "../lib/roster";
import { navigate } from "../lib/routes";

/** What Shift Manager calls the `shift-coordinator` worker (FIX-1747). */
const SHIFT_COORDINATOR_NAME = "Shift Coordinator";

export function WorkerSettingsView({ snapshot, workerId, devtoolUrl }: { snapshot: LoadedSnapshot; workerId: string; devtoolUrl?: string }) {
  const roster = useRoster(snapshot.readAt);
  const { workers } = withRoster(snapshot, roster);
  const worker = workers.find((w) => w.id === workerId);
  const shiftCoordinator = shiftCoordinatorOf(workers);
  const name = shiftCoordinator.kind === "one" && shiftCoordinator.worker.id === workerId ? SHIFT_COORDINATOR_NAME : (worker?.name ?? workerId);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="worker-settings" data-worker-id={workerId}>
      <header className="border-b px-5 py-3">
        <button type="button" onClick={() => navigate({ level: "roster", team: null })} className="text-xs text-muted-foreground hover:text-foreground" data-testid="worker-settings-back">
          ‹ Roster
        </button>
        <div className="mt-1 flex items-baseline gap-2">
          <ScreenTitle testId="worker-settings-title">{name}</ScreenTitle>
          <span className="border px-1 text-[10px] tracking-widest text-muted-foreground" data-testid="worker-settings-tag">
            SETTINGS
          </span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {worker === undefined ? (
          roster === undefined ? (
            <p className="text-sm text-muted-foreground" data-testid="worker-settings-reading">
              Reading your roster…
            </p>
          ) : "failure" in roster ? (
            <p className="text-sm text-muted-foreground" data-testid="worker-settings-roster-failure">
              Your own workers didn't load: {roster.failure.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="worker-settings-no-worker">
              {workerId} isn't on your roster.
            </p>
          )
        ) : worker.rules ? (
          <StandingRules key={worker.id} workerId={worker.id} name={name} devtoolUrl={devtoolUrl} />
        ) : (
          <section className="max-w-2xl space-y-3">
            <h2 className="font-mono text-[11px] font-semibold tracking-[0.1em]">RULES</h2>
            <p className="text-sm text-muted-foreground" data-testid="rules-not-kept">
              This worker's flow doesn't keep standing rules.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
