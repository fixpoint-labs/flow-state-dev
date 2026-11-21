/**
 * A coding task's review, as its popup draws it while the run waits on you:
 * the judge's verdict on top, then what changed, each check, what is worth
 * knowing beyond the change, the files and the original request; and, at the
 * popup's foot, one compose box with **Request changes**, **Merge locally**
 * and **Open pull request** (its menu accepts without landing).
 *
 * What changed, the run's own checks and its notes come from the run's
 * report, read with harness-manager's `runReport`; an answer without the
 * report's headings shows whole as What changed. The project's own checks
 * (`review.checks`) are drawn beside the run's, marked as the project's.
 *
 * A failed or not-done check, and each note, offers a next step: a check's
 * puts a request in the compose box, for Request changes; a note's asks the
 * worker that filed the task to follow up. Nothing is sent from the body.
 */
import { useMemo, useState, type ReactNode } from "react";
import { runReport, type ReviewDetail, type RunReport, type RunReportCheckStatus } from "@flow-state-dev/harness-manager/browser";
import { CheckIcon, ChevronDownIcon, InfoIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";
import { LandFailure, orderedLands, shortBranch, type ReviewAnswer, type ReviewLand } from "./flow-state/review-hold";
import { RunChanges } from "./flow-state/run-changes";
import { runCheckPassed } from "./flow-state/run-checks";

/** How a check line ended, as the review draws it. `reported` is a run's line that didn't say. */
export type CheckState = RunReportCheckStatus | "skipped" | "reported";

/** One line of the Checks list: the project's command checks first, then the run's own. */
export interface CheckLine {
  state: CheckState;
  /** What was checked, in Markdown. */
  title: string;
  /** What it found, in Markdown; `null` when the line said nothing more. */
  detail: string | null;
  /** The project ran it (`review.checks`), rather than the run saying it did. */
  project: boolean;
  /** The end of a project check's output. */
  tail?: string;
}

const seconds = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

/** "pnpm test — 2 failing" as its title and what it found; a line without a dash is all title. */
function split(text: string): { title: string; detail: string | null } {
  const at = text.search(/\s[—–]\s/);
  return at < 0 ? { title: text, detail: null } : { title: text.slice(0, at).trim(), detail: text.slice(at + 3).trim() || null };
}

/** The Checks list: each project check, then each check the run's report names. Exported for its test. */
export function checkLines(review: Pick<ReviewDetail, "checks">, report: RunReport | null): CheckLine[] {
  const project = (review.checks ?? []).map((check): CheckLine => {
    const state: CheckState = check.skipped ? "skipped" : runCheckPassed(check) ? "passed" : "failed";
    const ending = check.skipped ? "skipped" : check.timedOut ? "timed out" : check.exitCode === null ? "not run" : `exit ${check.exitCode}`;
    return { state, title: `\`${check.command}\``, detail: `Project check · ${ending}${check.skipped ? "" : ` · ${seconds(check.durationMs)}`}`, project: true, tail: check.tail };
  });
  const reported = (report?.checks ?? []).map((check): CheckLine => ({ state: check.status ?? "reported", ...split(check.text), project: false }));
  return [...project, ...reported];
}

/** How sure the judge is, in a word. */
const confidenceWord = (confidence: number) => (confidence >= 0.85 ? "high" : confidence >= 0.6 ? "medium" : "low");

/** The verdict card's words and tone. Exported for its test. */
export interface Verdict {
  headline: string;
  body: string;
  /** The judge's confidence, 0 to 1; `null` when no judge read the run. */
  confidence: number | null;
  tone: "success" | "warning" | "destructive" | "muted";
}

/** "3 passed, 1 not done", counting each check line by how it ended; empty when there are none. */
function checksSentence(lines: readonly CheckLine[]): string {
  const count = (state: CheckState) => lines.filter((line) => line.state === state).length;
  const parts = [
    [count("passed"), "passed"],
    [count("failed"), "failed"],
    [count("pre-existing"), "failing before this change too"],
    [count("not done"), "not done"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, words]) => `${n} ${words}`);
  return parts.length === 0 ? "" : `Checks: ${parts.join(", ")}.`;
}

/**
 * The verdict at the top: the judge's outcome, held against the checks. A
 * *done* with a failed or not-done check says so in its headline, since that
 * is the gap before shipping.
 */
export function verdictOf(review: Pick<ReviewDetail, "judge">, lines: readonly CheckLine[]): Verdict {
  const failed = lines.filter((line) => line.state === "failed").length;
  const open = lines.filter((line) => line.state === "not done").length;
  const checks = checksSentence(lines);
  const judge = review.judge;
  if (judge === null) return { headline: "No judge read this run", body: checks || "Read what changed and its checks below.", confidence: null, tone: "muted" };
  const reason = judge.reason.trim();
  const sure = `${reason === "" ? "The judge gave no reason" : reason.replace(/[.\s]+$/, "")}, with ${confidenceWord(judge.confidence)} confidence.`;
  const body = checks === "" ? sure : `${sure} ${checks}`;
  if (judge.verdict === "done") {
    if (failed > 0) return { headline: `Done, but ${failed} check${failed === 1 ? "" : "s"} failed`, body, confidence: judge.confidence, tone: "warning" };
    if (open > 0) return { headline: "Done, but not everything was checked", body, confidence: judge.confidence, tone: "warning" };
    return { headline: "Done", body, confidence: judge.confidence, tone: "success" };
  }
  if (judge.verdict === "not-done") return { headline: "Not done", body, confidence: judge.confidence, tone: "destructive" };
  if (judge.verdict === "ask") return { headline: "Needs your call", body, confidence: judge.confidence, tone: "warning" };
  return { headline: judge.verdict.charAt(0).toUpperCase() + judge.verdict.slice(1), body, confidence: judge.confidence, tone: "muted" };
}

const TONE_TEXT: Record<Verdict["tone"], string> = { success: "text-success", warning: "text-warning", destructive: "text-destructive", muted: "text-muted-foreground" };

/** The judge's confidence as a ring, filled to it. */
function ConfidenceRing({ confidence, tone }: { confidence: number | null; tone: Verdict["tone"] }) {
  const pct = confidence === null ? 0 : Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  return (
    <div
      aria-hidden
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", TONE_TEXT[tone])}
      style={{ background: `conic-gradient(currentColor 0 ${pct}%, var(--muted) ${pct}% 100%)` }}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-card text-xs font-semibold text-foreground">{confidence === null ? "–" : `${pct}%`}</div>
    </div>
  );
}

/** A section's small upper-case heading. */
function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** An inline Markdown line that wraps, where the card's default keeps it to one truncated line. */
const WRAP = "overflow-visible whitespace-normal";

const STATE_LABEL: Record<CheckState, string> = {
  passed: "Passed",
  failed: "Failed",
  "pre-existing": "Pre-existing",
  "not done": "Not done",
  skipped: "Skipped",
  reported: "Reported",
};

/** One check: its mark, what was checked and found, how it ended, and its next step. */
function CheckLineView({ line, onDraft }: { line: CheckLine; onDraft?: (text: string) => void }) {
  const [open, setOpen] = useState(line.state === "failed");
  const good = line.state === "passed";
  const bad = line.state === "failed";
  const gap = line.state === "not done";
  const Icon = good ? CheckIcon : bad ? XIcon : gap ? InfoIcon : MinusIcon;
  const next = bad ? "Request fix" : gap ? "Request check" : null;
  const words = (line.detail === null ? line.title : `${line.title} (${line.detail})`).replace(/`/g, "");
  const output = line.tail?.trim() ? line.tail : null;
  return (
    <li data-check={line.state} data-project={line.project || undefined} className={cn("flex flex-col border-b border-border last:border-b-0", gap && "bg-warning/5", bad && "bg-destructive/5")}>
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span
          className={cn(
            "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
            good ? "bg-success/15 text-success" : bad ? "bg-destructive/15 text-destructive" : gap ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-3" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <MarkdownText inline text={line.title} className={WRAP} />
          {line.detail === null ? null : <MarkdownText inline text={line.detail} className={cn(WRAP, "block text-xs text-muted-foreground")} />}
          {output === null ? null : (
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {open ? "Hide output" : "Show output"}
            </button>
          )}
        </div>
        {next !== null && onDraft !== undefined ? (
          <button
            type="button"
            onClick={() => onDraft(bad ? `Fix the failing check: ${words}` : `Do this check: ${words}`)}
            className={cn("h-7 shrink-0 rounded-md border px-2.5 text-xs whitespace-nowrap hover:bg-muted", gap ? "border-warning/40 text-warning" : "border-destructive/40 text-destructive")}
          >
            {next}
          </button>
        ) : (
          <span className={cn("shrink-0 text-xs whitespace-nowrap", good ? "text-success" : bad ? "text-destructive" : "text-muted-foreground")}>{STATE_LABEL[line.state]}</span>
        )}
      </div>
      {open && output !== null ? <pre className="overflow-x-auto border-t border-border bg-muted/40 px-3.5 py-2 font-mono text-xs leading-5">{output}</pre> : null}
    </li>
  );
}

/**
 * The review's body: verdict, What changed, Checks, Worth knowing, Files and
 * the original request. `onDraft` puts words in the compose box; `onFollowUp`
 * asks the task's filer to follow up on a note. Either absent: no button.
 */
export function ReviewBody({ review, onDraft, onFollowUp }: { review: ReviewDetail; onDraft?: (text: string) => void; onFollowUp?: (note: string) => void }) {
  // Parsed once per answer, not on each keystroke in the compose box.
  const report = useMemo(() => runReport(review.answer), [review.answer]);
  const lines = checkLines(review, report);
  const verdict = verdictOf(review, lines);
  const changed = report === null ? (review.answer ?? null) : report.changed;
  const round = review.round ?? null;
  const subjects = round?.subjects ?? review.subjects;
  return (
    <div data-review-body className="flex flex-col gap-5 [overflow-wrap:anywhere]">
      <section aria-label="Verdict" data-review-judge data-tone={verdict.tone} className="flex gap-3.5 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
        <ConfidenceRing confidence={verdict.confidence} tone={verdict.tone} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-sm font-semibold">{verdict.headline}</div>
          <p className="text-sm leading-relaxed text-muted-foreground">{verdict.body}</p>
        </div>
      </section>
      {changed ? (
        <Section label="What changed">
          <div data-review-answer className="text-sm">
            <MarkdownText text={changed} />
          </div>
        </Section>
      ) : null}
      {lines.length > 0 ? (
        <Section label="Checks">
          <ul className="overflow-hidden rounded-xl border border-border">
            {lines.map((line, i) => (
              <CheckLineView key={`${i}:${line.title}`} line={line} {...(onDraft ? { onDraft } : {})} />
            ))}
          </ul>
        </Section>
      ) : null}
      {(report?.notes.length ?? 0) > 0 ? (
        <Section label="Worth knowing">
          <ul className="flex flex-col gap-2">
            {report!.notes.map((note, i) => (
              <li key={i} data-note className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
                <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <MarkdownText inline text={note} className={cn(WRAP, "min-w-0 flex-1 text-sm text-muted-foreground")} />
                {onFollowUp ? (
                  <button type="button" onClick={() => onFollowUp(note)} className="h-7 shrink-0 rounded-md border border-border px-2.5 text-xs whitespace-nowrap hover:bg-muted">
                    Create follow-up
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {review.files != null || review.fileCount != null ? (
        <Section label="Files">
          <RunChanges
            files={review.files ?? null}
            {...(review.fileCount != null ? { fileCount: review.fileCount } : {})}
            {...(review.added != null ? { added: review.added } : {})}
            {...(review.removed != null ? { removed: review.removed } : {})}
            className="bg-background"
          />
        </Section>
      ) : null}
      {subjects.length > 0 ? (
        <details data-review-commits className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm text-muted-foreground">
            {round === null ? `${review.commits ?? subjects.length} commit${(review.commits ?? subjects.length) === 1 ? "" : "s"}` : `${round.commits} commit${round.commits === 1 ? "" : "s"} this round`}
          </summary>
          <ul className="px-3.5 pb-3 text-xs text-muted-foreground">
            {subjects.map((subject, i) => (
              <li key={i}>
                · <MarkdownText inline text={subject} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {review.goal ? (
        <details data-review-goal className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm text-muted-foreground">Original request</summary>
          <MarkdownText text={review.goal} className="px-3.5 pb-3 text-sm text-muted-foreground" />
        </details>
      ) : null}
    </div>
  );
}

/** The review's line under the title: its commits, branch and pull requests. */
export function ReviewMeta({ review }: { review: ReviewDetail }) {
  const commits = review.commits === null ? null : `${review.commits} commit${review.commits === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-muted-foreground" data-review-meta>
      {commits === null ? null : <span data-review-commit-count>{commits}</span>}
      {review.branch === null ? null : (
        <span title={review.branch} data-review-branch>
          {shortBranch(review.branch)}
        </span>
      )}
      {(review.pullRequests ?? []).map((pr) => (
        <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" className="underline">
          PR #{pr.number}
        </a>
      ))}
    </div>
  );
}

/** Each way to land, as the footer's buttons say it. */
const LAND_BUTTON: Record<ReviewLand, string> = { "pull-request": "Open pull request", merge: "Merge locally" };

/** What the primary button does, in a line under the buttons. Exported for its test. */
export function landHint(land: ReviewLand | null, review: Pick<ReviewDetail, "branch">, open: number): string {
  const branch = review.branch === null ? "the run's branch" : shortBranch(review.branch);
  const said =
    land === "pull-request"
      ? `Opens a PR from ${branch}, with the goal, commits, checks and the judge's verdict as its description.`
      : land === "merge"
        ? `Merges ${branch} into your checkout.`
        : "Completes the task; the branch stays as it is.";
  return open === 0 ? said : `${said} ${open} check${open === 1 ? " is" : "s are"} still open.`;
}

/**
 * The review's foot: the compose box and the answers. **Request changes**
 * sends the box's words back to the run; each way to land is an accept naming
 * it, carrying the words as its note (the coding session reads it if landing
 * fails); the primary button's menu accepts without landing. A failed landing
 * shows why, and its way comes first, as **Retry**. A hold whose review
 * can't be read (not a coding run's, or not read yet) gets the same foot with
 * its prompt above the box: Accept and Request changes, no ways to land.
 */
export function ReviewFooter({
  review,
  prompt,
  words,
  setWords,
  answer,
  unanswerable,
  holdId,
}: {
  /** The run's review; `undefined` when the hold has none to read. */
  review: ReviewDetail | undefined;
  /** The hold's own prompt, shown when there is no review. */
  prompt?: string;
  words: string;
  setWords: (words: string) => void;
  answer: (answer: ReviewAnswer) => Promise<void>;
  unanswerable: string | null;
  holdId: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sent, setSent] = useState<string | null | undefined>(undefined);
  const answerText = review?.answer;
  const report = useMemo(() => runReport(answerText), [answerText]);
  const failed = review?.landFailed ?? null;
  // A review asked again after a landing failed is a new ask: its buttons come back.
  const ask = holdId ?? failed?.message ?? null;
  if (unanswerable !== null) {
    return (
      <p className="text-xs text-muted-foreground" data-review-unanswerable>
        {unanswerable}
      </p>
    );
  }
  if (sent !== undefined && sent === ask) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Sent.
      </p>
    );
  }
  const send = async (reply: ReviewAnswer) => {
    if (pending) return;
    setPending(true);
    setMenu(false);
    setError(null);
    try {
      await answer(reply);
      setSent(ask);
      setWords("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The answer didn't go through.");
    } finally {
      setPending(false);
    }
  };
  const note = words.trim();
  const revise = () => {
    if (note !== "") void send({ verdict: "revise", words: note });
  };
  const accept = (land?: ReviewLand) => void send({ verdict: "accepted", ...(land ? { land } : {}), ...(land && note !== "" ? { words: note } : {}) });
  const ordered = orderedLands(review?.lands ?? [], failed);
  const primary = ordered[0] ?? null;
  const others = ordered.slice(1);
  const open = (review === undefined ? [] : checkLines(review, report)).filter((line) => line.state === "failed" || line.state === "not done").length;
  const label = (land: ReviewLand) => (failed?.land === land ? `Retry: ${LAND_BUTTON[land]}` : LAND_BUTTON[land]);
  const secondary = "h-9 rounded-lg border border-border px-3.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <section aria-label="Your review" data-review-footer className="flex flex-col gap-3">
      {review === undefined && prompt ? (
        <div className="text-sm" data-review-prompt>
          <MarkdownText text={prompt} />
        </div>
      ) : null}
      <LandFailure failed={failed} />
      {(review?.landAttempts?.length ?? 0) > 1 ? (
        <ol data-land-attempts className="list-decimal pl-4 text-xs text-muted-foreground">
          {review!.landAttempts!.map((attempt, i) => (
            <li key={i} title={attempt.message} className="line-clamp-2">
              Try {i + 1}: {attempt.message}
            </li>
          ))}
        </ol>
      ) : null}
      <textarea
        aria-label="Note for the run"
        value={words}
        rows={2}
        disabled={pending}
        onChange={(e) => setWords(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            revise();
          }
        }}
        placeholder={primary === null ? "What should change? Sent with Request changes" : "What should change, or a note the run reads if landing fails"}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || note === ""} onClick={revise} className={secondary}>
          Request changes
        </button>
        <span className="flex-1" />
        {others.map((land) => (
          <button key={land} type="button" data-land={land} disabled={pending} onClick={() => accept(land)} className={secondary}>
            {label(land)}
          </button>
        ))}
        <div className="relative flex">
          <button
            type="button"
            data-land={primary ?? undefined}
            disabled={pending}
            onClick={() => accept(primary ?? undefined)}
            className={cn("h-9 bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50", primary === null ? "rounded-lg" : "rounded-l-lg")}
          >
            {primary === null ? "Accept" : label(primary)}
          </button>
          {primary === null ? null : (
            <>
              <button
                type="button"
                aria-label="More ways to accept"
                aria-haspopup="menu"
                aria-expanded={menu}
                disabled={pending}
                onClick={() => setMenu(!menu)}
                className="flex h-9 w-8 items-center justify-center rounded-r-lg border-l border-primary-foreground/25 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <ChevronDownIcon aria-hidden className="size-3.5" />
              </button>
              {menu ? (
                <div role="menu" className="absolute right-0 bottom-full z-10 mb-1 min-w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={() => accept()} className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted">
                    Accept without landing
                    <span className="text-xs text-muted-foreground">Completes the task; the branch stays as it is.</span>
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-land-hint>
        {landHint(primary, review ?? { branch: null }, open)}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The compose at the popup's foot while a task is open and nothing waits on
 * you: its words join the task's brief (the board's steer). Enter sends,
 * Shift+Enter starts a new line.
 */
export function SteerCompose({ words, setWords, steer, placeholder }: { words: string; setWords: (words: string) => void; steer: (message: string) => Promise<void>; placeholder?: string }) {
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    const message = words.trim();
    if (message === "" || pending) return;
    setPending(true);
    setSaid(null);
    try {
      await steer(message);
      setWords("");
      setSaid({ ok: true, text: "Sent to the task." });
    } catch (error) {
      setSaid({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-label="Steer" className="flex flex-col gap-2">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <textarea
          aria-label="Steer this task"
          data-testid="task-action-steer-input"
          value={words}
          rows={2}
          disabled={pending}
          placeholder={placeholder ?? "Steer this task: what to do differently, or what else it should know"}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
        />
        <button
          type="button"
          data-testid="task-action-steer"
          disabled={pending || words.trim() === ""}
          onClick={() => void send()}
          className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending…" : "Steer"}
        </button>
      </div>
      {said === null ? null : (
        <p role={said.ok ? "status" : "alert"} data-testid={said.ok ? "task-action-outcome" : "task-action-refusal"} className={cn("text-xs", said.ok ? "text-muted-foreground" : "text-destructive")}>
          {said.text}
        </p>
      )}
    </section>
  );
}
