/**
 * A roster worker's Rules (`/roster/<workerId>/rules`, FIX-1945): the
 * standing rules that worker keeps for the user, opened from its Roster row.
 *
 * Only a worker on a flow Workforce says keeps rules has them (BR-20). A worker on any other flow gets a line saying its flow doesn't
 * keep them, rather than an empty list it could never fill (BR-21a).
 */
import { StandingRules } from "../components/StandingRules";
import { ScreenTitle } from "../components/ui";
import { chiefOfStaffOf, type LoadedSnapshot } from "../lib/derive";
import { useRoster, withRoster } from "../lib/roster";
import { navigate } from "../lib/routes";

/** What Shift Manager calls the chief of staff worker (FIX-1747); the worker keeps its id. */
const COS_NAME = "Shift Coordinator";

export function RulesView({ snapshot, workerId, devtoolUrl }: { snapshot: LoadedSnapshot; workerId: string; devtoolUrl?: string }) {
  const roster = useRoster(snapshot.readAt);
  const { workers } = withRoster(snapshot, roster);
  const worker = workers.find((w) => w.id === workerId);
  const cos = chiefOfStaffOf(workers);
  const name = cos.kind === "one" && cos.worker.id === workerId ? COS_NAME : (worker?.name ?? workerId);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="rules-view" data-worker-id={workerId}>
      <header className="border-b px-5 py-3">
        <button type="button" onClick={() => navigate({ level: "roster", team: null })} className="text-xs text-muted-foreground hover:text-foreground" data-testid="rules-back">
          ‹ Roster
        </button>
        <div className="mt-1 flex items-baseline gap-2">
          <ScreenTitle testId="rules-title">{name}</ScreenTitle>
          <span className="border px-1 text-[10px] tracking-widest text-muted-foreground">RULES</span>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {worker === undefined ? (
          roster === undefined ? (
            <p className="text-sm text-muted-foreground" data-testid="rules-worker-reading">
              Reading your roster…
            </p>
          ) : "failure" in roster ? (
            <p className="text-sm text-muted-foreground" data-testid="rules-roster-failure">
              Your own workers didn't load: {roster.failure.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="rules-no-worker">
              {workerId} isn't on your roster.
            </p>
          )
        ) : worker.rules ? (
          <StandingRules key={worker.id} workerId={worker.id} name={name} devtoolUrl={devtoolUrl} />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="rules-not-kept">
            This worker's flow doesn't keep standing rules.
          </p>
        )}
      </div>
    </div>
  );
}
