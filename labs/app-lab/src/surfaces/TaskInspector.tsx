/**
 * The right panel's task slot: the task inspector (S7, BR-18 to BR-23).
 *
 * Worker and team from the seat inventory, started from the row, the plan and
 * files the run recorded under its own request (read once per open, no
 * stream), the rows it waits on and the rows waiting on it from the same board
 * read, and a link to the devtool the page was started with. Harness, tokens,
 * cost, acceptance and *review by* are named gaps from the gap registry.
 */
import { useEffect, useState, type ReactNode } from "react";
import { SectionFailure } from "../components/ui";
import { rosterOf, seatFor, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure } from "../lib/reads";
import { navigate } from "../lib/routes";
import { readRecordedWork, RunReadError, type OpenRun, type RecordedWork } from "../lib/run";
import { useTask } from "../lib/task";
import type { Gaps } from "../gaps";

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section className="border-b px-4 py-3" data-testid={testId}>
      <h3 className="pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Gap({ text, testId }: { text: string; testId: string }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid={testId} data-gap={text}>
      {text}
    </p>
  );
}

export function TaskInspector({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const task = useTask();
  const { row } = task;
  const seat = row === undefined ? undefined : seatFor(rosterOf(snapshot), row);
  const after = row === undefined ? [] : task.boardRows.filter((r) => row.deps.includes(r.id));
  const missingAfter = row === undefined ? [] : row.deps.filter((id) => !task.boardRows.some((r) => r.id === id));
  const blocks = row === undefined ? [] : task.boardRows.filter((r) => r.deps.includes(row.id));
  const open = (id: string) => navigate({ level: "task", boardRef: task.boardRef, taskId: id, tab: "session" });

  return (
    <div data-testid="task-panel-slot">
      <div data-testid="task-inspector">
        <Section title="WORKER" testId="inspector-worker">
          <p className="text-sm" data-testid="inspector-worker-id" data-seat-id={seat?.id ?? ""}>
            {seat?.id ?? row?.assignee ?? "No worker named"}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="inspector-team">
            {seat === undefined ? "" : `team ${seat.team}`}
          </p>
        </Section>
        <Section title="STARTED" testId="inspector-started">
          <p className="text-sm" data-testid="inspector-started-at" data-started-at={row?.startedAt ?? ""}>
            {row?.startedAt == null ? "Not started" : new Date(row.startedAt).toLocaleString()}
          </p>
        </Section>
        <Section title="HARNESS · TOKENS · COST" testId="inspector-harness">
          <Gap text={gaps.task.harness} testId="inspector-harness-gap" />
        </Section>
        <Section title="ACCEPTANCE" testId="inspector-acceptance">
          <Gap text={gaps.task.acceptance} testId="inspector-acceptance-gap" />
          <Gap text={gaps.task.reviewBy} testId="inspector-review-gap" />
        </Section>
        {task.run.kind === "open" ? (
          <Recorded key={task.run.run.requestId} run={task.run.run} gaps={gaps} />
        ) : (
          <Section title="PLAN · FILES" testId="inspector-recorded">
            <p className="text-xs text-muted-foreground" data-testid="inspector-recorded-none">
              {task.run.kind === "none" ? "No run has started, so nothing is recorded yet." : "Waiting for the run to open."}
            </p>
          </Section>
        )}
        <Section title="LINKED" testId="inspector-linked">
          <p className="text-[11px] text-muted-foreground">After</p>
          <ul className="mb-2 text-sm" data-testid="inspector-after">
            {after.map((r) => (
              <li key={r.id} data-task-id={r.id}>
                <button type="button" className="hover:underline" onClick={() => open(r.id)}>
                  {r.title}
                </button>
              </li>
            ))}
            {missingAfter.map((id) => (
              <li key={id} data-task-id={id} className="text-muted-foreground">
                {id} (not on this board)
              </li>
            ))}
            {row?.deps.length === 0 ? <li className="text-xs text-muted-foreground">Nothing</li> : null}
          </ul>
          <p className="text-[11px] text-muted-foreground">Blocks</p>
          <ul className="text-sm" data-testid="inspector-blocks">
            {blocks.map((r) => (
              <li key={r.id} data-task-id={r.id}>
                <button type="button" className="hover:underline" onClick={() => open(r.id)}>
                  {r.title}
                </button>
              </li>
            ))}
            {blocks.length === 0 ? <li className="text-xs text-muted-foreground">Nothing</li> : null}
          </ul>
        </Section>
        <Section title="TRACE" testId="inspector-trace">
          <Trace />
        </Section>
      </div>
    </div>
  );
}

/** The plan and files the run recorded, read once per open (BR-19, BR-20). */
function Recorded({ run, gaps }: { run: OpenRun; gaps: Gaps }) {
  const { clients } = useLab();
  const [work, setWork] = useState<RecordedWork | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailure(undefined);
    readRecordedWork(clients, run)
      .then((read) => {
        if (live) setWork(read);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof RunReadError ? error.failure : describeFailure(error));
      });
    return () => {
      live = false;
    };
  }, [clients, run, attempt]);

  if (failure !== undefined) {
    return (
      <Section title="PLAN · FILES" testId="inspector-recorded">
        <SectionFailure what="What the run recorded" failure={failure} onRetry={() => setAttempt((n) => n + 1)} />
      </Section>
    );
  }
  if (work === undefined) {
    return (
      <Section title="PLAN · FILES" testId="inspector-recorded">
        <p className="text-xs text-muted-foreground">Reading what the run recorded…</p>
      </Section>
    );
  }
  const more = (truncated: boolean) =>
    truncated ? (
      <p className="text-xs text-muted-foreground">
        More than shown.{" "}
        <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </p>
    ) : null;
  return (
    <>
      <Section title="PLAN" testId="inspector-plan">
        {work.plan === null ? (
          <Gap text={gaps.task.recordsNoPlan} testId="inspector-plan-none" />
        ) : (
          <ol className="space-y-0.5 text-sm">
            {work.plan.rows.map((step) => (
              <li key={step.id} data-testid="inspector-plan-step" data-step-id={step.id} data-status={step.status ?? ""}>
                <span className="text-xs text-muted-foreground">{step.status ?? "no status"}</span> {step.title}
              </li>
            ))}
            {work.plan.rows.length === 0 ? <li className="text-xs text-muted-foreground">The run recorded no plan.</li> : null}
            {more(work.plan.truncated)}
          </ol>
        )}
      </Section>
      <Section title="FILES" testId="inspector-files">
        {work.files === null ? (
          <Gap text={gaps.task.recordsNoFiles} testId="inspector-files-none" />
        ) : (
          <ul className="space-y-0.5 text-sm">
            {work.files.rows.map((file) => (
              <li key={file.path} data-testid="inspector-file" data-path={file.path} data-kind={file.kind ?? ""}>
                <span className="font-mono text-xs">{file.path}</span>{" "}
                <span className="text-xs text-muted-foreground">{file.kind ?? "touched"}</span>
              </li>
            ))}
            {work.files.rows.length === 0 ? <li className="text-xs text-muted-foreground">The run recorded no file operations.</li> : null}
            {more(work.files.truncated)}
          </ul>
        )}
      </Section>
    </>
  );
}

/** The devtool link, with the run's session id beside it (BR-23). */
function Trace() {
  const task = useTask();
  const sessionId = task.run.kind === "open" ? task.run.run.sessionId : task.row?.run?.sessionId;
  if (task.devtoolUrl === undefined) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="inspector-trace-off">
        Open trace is off. Start App Lab with <code>--devtool &lt;url&gt;</code> to link the devtool here.
      </p>
    );
  }
  return (
    <div className="text-xs">
      <a href={task.devtoolUrl} target="_blank" rel="noreferrer" className="font-medium underline" data-testid="inspector-trace-link">
        Open trace
      </a>
      {sessionId === undefined ? null : (
        <p className="mt-1 text-muted-foreground">
          Session <code data-testid="inspector-trace-session">{sessionId}</code>. Paste it into the devtool to find the run.
        </p>
      )}
    </div>
  );
}
