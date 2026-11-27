/**
 * A coding task's review, as its popup draws it while the run waits on you:
 * the judge's verdict on top, then what changed, each check, what is worth
 * knowing beyond the change, the files and the original request; and, at the
 * popup's foot, one compose box with **Request changes**, **Merge locally**
 * and **Open pull request** (its menu accepts without landing). A branch
 * with a pull request already open from it offers **Push to PR #N** and a
 * **View PR #N** link instead: its work goes there, never onto a second one.
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
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { RUN_REPORT_HEADINGS, runReport, type ReviewDetail, type RunReport, type RunReportCheckStatus } from "@flow-state-dev/harness-manager/browser";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, InfoIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";
import { LandFailure, landLabel, orderedLands, shortBranch, type ReviewAnswer, type ReviewLand } from "./flow-state/review-hold";
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

/** A Markdown heading line, trimmed first: no optional run before `$` to backtrack over on a long line. */
const HEADING_LINE = /^#{1,4}\s+(.+)$/;
const REPORT_HEADINGS = new Set(Object.values(RUN_REPORT_HEADINGS).map((heading) => heading.toLowerCase()));

/**
 * The answer's report, only when the report is all of it: it opens on one of the report's headings and
 * has no other heading. Drawn as sections, any other text would be lost, so an answer with more (a
 * "Next steps", a researcher's own outline, prose before the first heading) is `null` and shows whole.
 * Exported for its test.
 */
export function wholeReport(answer: string | null | undefined): RunReport | null {
  if (answer == null) return null;
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const headings = lines.flatMap((line) => {
    const match = HEADING_LINE.exec(line);
    if (match === null) return [];
    // A closing run of #s ("## Checks ##") is dropped by a scan from the end: linear, where `/#+$/` isn't.
    const text = match[1]!;
    let end = text.length;
    while (end > 0 && text[end - 1] === "#") end--;
    return [text.slice(0, end).replace(/[:*_`]/g, "").trim().toLowerCase()];
  });
  if (lines.length === 0 || !HEADING_LINE.test(lines[0]!) || headings.some((heading) => !REPORT_HEADINGS.has(heading))) return null;
  return runReport(answer);
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

/**
 * The judge's score as an ink ring: the score drawn solid, the remainder
 * dashed, the figure inside. No judge, an all-dashed ring and a dash.
 */
function ConfidenceRing({ confidence }: { confidence: number | null }) {
  const pct = confidence === null ? 0 : Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const r = 20;
  const around = 2 * Math.PI * r;
  const score = (around * pct) / 100;
  return (
    <div aria-hidden className="relative flex size-12 shrink-0 items-center justify-center" data-ring={pct}>
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-12 -rotate-90" fill="none" strokeWidth="3">
        <circle cx="24" cy="24" r={r} stroke="var(--line3)" strokeDasharray="2 3" />
        {pct === 0 ? null : <circle cx="24" cy="24" r={r} stroke="var(--ink)" strokeLinecap="round" strokeDasharray={`${score} ${around}`} />}
      </svg>
      <span className="font-mono text-xs font-semibold text-foreground tabular-nums">{confidence === null ? "–" : `${pct}%`}</span>
    </div>
  );
}

/** A section's small upper-case heading. */
function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-xs font-medium tracking-[0.08em] text-text-3 uppercase">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A folded block: a chevron that turns as it opens, the same look as the Files block's. Exported for the popup's steps. */
export function Fold({ label, children, ...data }: { label: ReactNode; children: ReactNode } & Record<`data-${string}`, boolean | undefined>) {
  return (
    <details {...data} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm text-text-2 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="border-t border-border px-3.5 py-3">{children}</div>
    </details>
  );
}

/**
 * A check's detail as two parts: a lead of "·"-joined facts ("vitest · labs/x · 310 / 310"), set in
 * mono, and the prose after it. A detail whose first sentence has no "·" is all prose. A sentence ends
 * at a full stop before a space or the end, so "4.2s" or "v1.2.3" stay inside the facts. Exported for its test.
 */
export function detailParts(detail: string): { facts: string | null; prose: string | null } {
  const end = detail.search(/\.(\s|$)/);
  const head = end < 0 ? detail : detail.slice(0, end);
  if (!head.includes(" · ")) return { facts: null, prose: detail };
  const rest = end < 0 ? "" : detail.slice(end + 1).trim();
  return { facts: head.trim(), prose: rest === "" ? null : rest };
}

/** An inline Markdown line that wraps, where the card's default keeps it to one truncated line. */
const WRAP = "overflow-visible whitespace-normal";

/** Inline code at the size of the small text around it, rather than the body's. */
const CODE_FITS = "[&_code]:px-1 [&_code]:py-0 [&_code]:text-xs";

const STATE_LABEL: Record<CheckState, string> = {
  passed: "Passed",
  failed: "Failed",
  "pre-existing": "Pre-existing",
  "not done": "Not run",
  skipped: "Skipped",
  reported: "Reported",
};

/** A check's result as plain coloured text: green passed, red failed, grey otherwise. */
const STATE_TEXT: Record<CheckState, string> = {
  passed: "text-success-text",
  failed: "text-destructive",
  "pre-existing": "text-text-3",
  "not done": "text-text-3",
  skipped: "text-text-3",
  reported: "text-text-3",
};

/** One check: its mark, what was checked and found, how it ended, and its next step. */
function CheckLineView({ line, onDraft }: { line: CheckLine; onDraft?: (text: string) => void }) {
  const [open, setOpen] = useState(line.state === "failed");
  const good = line.state === "passed";
  const bad = line.state === "failed";
  const gap = line.state === "not done";
  const Icon = good ? CheckIcon : bad ? XIcon : MinusIcon;
  const next = bad ? "Request fix" : gap ? "Request check" : null;
  const words = (line.detail === null ? line.title : `${line.title} (${line.detail})`).replace(/`/g, "");
  const output = line.tail?.trim() ? line.tail : null;
  const parts = line.detail === null ? null : detailParts(line.detail);
  return (
    <li data-check={line.state} data-project={line.project || undefined} className="flex flex-col border-b border-border last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Round marks: green ✓ passed, red ✗ failed, a dashed ring for not yet run, grey – otherwise. */}
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
            good ? "bg-success-soft text-success-text" : bad ? "bg-(--redbg) text-destructive" : gap ? "border-[1.5px] border-dashed border-text-3" : "bg-muted text-text-3",
          )}
        >
          {gap ? null : <Icon aria-hidden className="size-3" strokeWidth={3} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <MarkdownText inline text={line.title} className={cn(WRAP, "font-medium")} />
          {parts?.facts ? <MarkdownText inline text={parts.facts} className={cn(WRAP, CODE_FITS, "block font-mono text-xs text-text-3")} /> : null}
          {parts?.prose ? <MarkdownText inline text={parts.prose} className={cn(WRAP, CODE_FITS, "block text-xs leading-relaxed text-text-2")} /> : null}
          {output === null ? null : (
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-0.5 self-start text-xs text-text-2 underline-offset-2 hover:underline">
              {open ? "Hide output" : "Show output"}
            </button>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-2.5">
          {next !== null && onDraft !== undefined ? (
            <button
              type="button"
              onClick={() => onDraft(bad ? `Fix the failing check: ${words}` : `Do this check: ${words}`)}
              className="h-7 shrink-0 rounded-md border border-border-strong px-2.5 text-xs font-medium whitespace-nowrap hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              {next}
            </button>
          ) : null}
          <span className={cn("pt-px text-xs font-medium whitespace-nowrap", STATE_TEXT[line.state])} data-check-result>
            {STATE_LABEL[line.state]}
          </span>
        </span>
      </div>
      {open && output !== null ? <pre className="overflow-x-auto border-t border-border bg-muted px-4 py-2.5 font-mono text-xs leading-5">{output}</pre> : null}
    </li>
  );
}

/** A run's Markdown prose: the lead paragraphs in the body colour, bullets a step quieter, bold words bright. */
const PROSE =
  "text-sm leading-relaxed text-text-2 [&_li]:pl-1 [&_ul]:list-outside [&_ul]:pl-5 [&_p]:text-base [&_p]:leading-relaxed [&_p]:text-foreground [&_[data-streamdown=strong]]:text-foreground";

/**
 * A run report's sections: What changed, Checks and Worth knowing, each left out when empty. `onDraft`
 * gives a failed or not-done check its button; `onFollowUp` gives each note one.
 */
function ReportSections({ changed, lines, notes, onDraft, onFollowUp }: { changed: string | null; lines: readonly CheckLine[]; notes: readonly string[]; onDraft?: (text: string) => void; onFollowUp?: (note: string) => void }) {
  return (
    <>
      {changed ? (
        <Section label="What changed">
          <div data-review-answer className={PROSE}>
            <MarkdownText text={changed} />
          </div>
        </Section>
      ) : null}
      {lines.length > 0 ? (
        <Section label="Checks">
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {lines.map((line, i) => (
              <CheckLineView key={`${i}:${line.title}`} line={line} {...(onDraft ? { onDraft } : {})} />
            ))}
          </ul>
        </Section>
      ) : null}
      {notes.length > 0 ? (
        <Section label="Worth knowing">
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {notes.map((note, i) => (
              <li key={i} data-note className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <InfoIcon aria-hidden className="mt-[3px] size-3.5 shrink-0 text-text-3" />
                <MarkdownText inline text={note} className={cn(WRAP, CODE_FITS, "min-w-0 flex-1 text-sm leading-relaxed text-text-2 [&_[data-streamdown=strong]]:text-foreground")} />
                {onFollowUp ? (
                  <button type="button" onClick={() => onFollowUp(note)} aria-label="Create follow-up" className="h-7 shrink-0 rounded-md border border-border-strong px-2.5 text-xs font-medium whitespace-nowrap hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                    + Follow-up task
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/**
 * A task's final answer, outside a review: a coding run's report as its sections when the report is all
 * of it (its checks as it reported them); anything else, and every answer of a task that isn't a coding
 * run (`report` false), whole, as prose.
 */
export function RunAnswer({ answer, report: asReport }: { answer: string; report: boolean }) {
  const report = useMemo(() => (asReport ? wholeReport(answer) : null), [answer, asReport]);
  if (report === null) {
    return (
      <div className={PROSE}>
        <MarkdownText text={answer} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ReportSections changed={report.changed} lines={checkLines({ checks: null }, report)} notes={report.notes} />
    </div>
  );
}

/**
 * The review's body: verdict, What changed, Checks, Worth knowing, Files and
 * the original request. `onDraft` puts words in the compose box; `onFollowUp`
 * asks the task's filer to follow up on a note. Either absent: no button.
 */
export function ReviewBody({ review, onDraft, onFollowUp }: { review: ReviewDetail; onDraft?: (text: string) => void; onFollowUp?: (note: string) => void }) {
  // Parsed once per answer, not on each keystroke in the compose box.
  const report = useMemo(() => wholeReport(review.answer), [review.answer]);
  const lines = checkLines(review, report);
  const verdict = verdictOf(review, lines);
  const changed = report === null ? (review.answer ?? null) : report.changed;
  const round = review.round ?? null;
  const subjects = round?.subjects ?? review.subjects;
  return (
    <div data-review-body className="flex flex-col gap-6 [overflow-wrap:anywhere]">
      <section aria-label="Verdict" data-review-judge data-tone={verdict.tone} className="flex items-start gap-4 rounded-lg border border-border bg-card px-4 py-4 shadow-(--shadow-card)">
        <ConfidenceRing confidence={verdict.confidence} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-base leading-6 font-semibold">{verdict.headline}</div>
          <p className="text-sm leading-relaxed text-text-2">{verdict.body}</p>
        </div>
      </section>
      <ReportSections changed={changed} lines={lines} notes={report?.notes ?? []} {...(onDraft ? { onDraft } : {})} {...(onFollowUp ? { onFollowUp } : {})} />
      {/* Files, then the commits and the original request, folded: one group, closer together than the sections above. */}
      <div className="flex flex-col gap-2 empty:hidden">
        {review.files != null || review.fileCount != null ? (
          <Section label="Files">
            <RunChanges
              files={review.files ?? null}
              {...(review.fileCount != null ? { fileCount: review.fileCount } : {})}
              {...(review.added != null ? { added: review.added } : {})}
              {...(review.removed != null ? { removed: review.removed } : {})}
              className="rounded-lg border-border bg-card [&>button]:px-3.5 [&>button]:py-2.5"
            />
          </Section>
        ) : null}
        {subjects.length > 0 ? (
          <Fold
            data-review-commits
            label={round === null ? `${review.commits ?? subjects.length} commit${(review.commits ?? subjects.length) === 1 ? "" : "s"}` : `${round.commits} commit${round.commits === 1 ? "" : "s"} this round`}
          >
            <ul className="flex flex-col gap-1 font-mono text-xs text-text-2">
              {subjects.map((subject, i) => (
                <li key={i}>
                  <MarkdownText inline text={subject} className={WRAP} />
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
        {review.goal ? (
          <Fold data-review-goal label="Original request">
            <MarkdownText text={review.goal} className="text-sm text-text-2" />
          </Fold>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A coding task's line under the title, its parts "·"-joined: what it ran on, what it spent, the
 * current attempt's time so far (waits included) and, while its run waits for review, its commits and
 * branch; then each pull request, a link once its address is known. `on` is "Claude Code ·
 * claude-opus-5-5"; `tokens` is "1.3M tokens". Nothing to say: no line.
 */
export function RunMeta({
  review,
  on,
  tokens,
  total,
  pullRequests,
}: {
  review?: ReviewDetail;
  on?: string;
  tokens?: string;
  /** The current attempt's time so far, waits included ("2d 3h"). */
  total?: string;
  pullRequests?: ReadonlyArray<{ number: number; url?: string }>;
}) {
  const prs = pullRequests ?? review?.pullRequests ?? [];
  const commits = review?.commits == null ? null : `${review.commits} commit${review.commits === 1 ? "" : "s"}`;
  const parts: ReactNode[] = [
    on === undefined ? null : (
      <span key="on" data-harness>
        {on}
      </span>
    ),
    tokens === undefined ? null : <span key="tokens">{tokens}</span>,
    total === undefined ? null : (
      <span key="total" title="Time on this attempt, waits included" data-run-total>
        {total}
      </span>
    ),
    commits === null ? null : (
      <span key="commits" data-review-commit-count>
        {commits}
      </span>
    ),
    review == null || review.branch === null ? null : (
      <span key="branch" title={review.branch} data-review-branch>
        {shortBranch(review.branch)}
      </span>
    ),
    ...prs.map((pr) =>
      pr.url === undefined ? (
        <span key={pr.number} data-meta-pull-request>
          #{pr.number}
        </span>
      ) : (
        <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer" data-meta-pull-request className="inline-flex items-center gap-0.5 font-medium text-brand underline-offset-2 hover:underline">
          #{pr.number}
          <ArrowUpRightIcon aria-hidden className="size-3" />
        </a>
      ),
    ),
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-text-3" data-run-meta>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i === 0 ? null : <span aria-hidden>·</span>}
          {part}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Each way to land, as the footer's buttons say it: onto the pull request the work is already on, "Push update";
 * onto one open from the branch, the registry's "Push to PR #N".
 */
const landButton = (land: ReviewLand, review: Pick<ReviewDetail, "openPullRequest" | "pullRequest"> | undefined): string =>
  land === "pull-request" && review?.pullRequest != null && review.openPullRequest?.url === review.pullRequest.url
    ? "Push update"
    : land === "pull-request" && review?.openPullRequest == null
      ? "Open pull request"
      : landLabel(land, review?.openPullRequest);

/** What the primary button does, in a line under the buttons. Exported for its test. */
export function landHint(land: ReviewLand | null, review: Pick<ReviewDetail, "branch" | "openPullRequest" | "pullRequest">, open: number): string {
  const branch = review.branch === null ? "the run's branch" : shortBranch(review.branch);
  const onto = review.openPullRequest ?? null;
  const lacks = onto?.url === review.pullRequest?.url ? review.pullRequest?.unpushed ?? null : null;
  const said =
    land === "pull-request"
      ? onto !== null
        ? lacks === null
          ? `Pushes ${branch} to PR #${onto.number}, already open from it; no second PR is opened.`
          : `Pushes the ${lacks} commit${lacks === 1 ? "" : "s"} PR #${onto.number} lacks from ${branch}; no second PR is opened.`
        : `Opens a PR from ${branch}, with the goal, commits, checks and the judge's verdict as its description.`
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
  const report = useMemo(() => wholeReport(answerText), [answerText]);
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
  const label = (land: ReviewLand) => (failed?.land === land ? `Retry: ${landButton(land, review)}` : landButton(land, review));
  const onto = review?.openPullRequest ?? null;
  // The pull request the work is already on, with its state as read; else the one open from the branch.
  const on = review?.pullRequest ?? null;
  const linked = on ?? onto;
  // A disabled secondary keeps its border, so it still reads as a button; only its words dim.
  const secondary = "h-9 rounded-md border border-border-strong px-3.5 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <section aria-label="Your review" data-review-footer className="flex flex-col gap-3 py-1">
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
        className="w-full resize-none rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm placeholder:text-text-3 focus-visible:border-ring focus-visible:outline-none"
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
            className={cn("h-9 bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", primary === null ? "rounded-md" : "rounded-l-md")}
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
                className="flex h-9 w-8 items-center justify-center rounded-r-md border-l border-primary-foreground/25 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronDownIcon aria-hidden className="size-3.5" />
              </button>
              {menu ? (
                <div role="menu" className="absolute right-0 bottom-full z-10 mb-1.5 min-w-60 rounded-lg border border-border bg-card p-1 shadow-(--shadow-card)">
                  <button type="button" role="menuitem" onClick={() => accept()} className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-accent">
                    Accept without landing
                    <span className="text-xs font-normal text-text-2">Completes the task; the branch stays as it is.</span>
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-text-3" data-land-hint>
        {landHint(primary, review ?? { branch: null }, open)}
        {linked === null ? null : (
          <>
            {" "}
            <a href={linked.url} target="_blank" rel="noreferrer" data-open-pull-request className="inline-flex items-center gap-0.5 font-medium text-brand underline-offset-2 hover:underline">
              {on === null ? `View PR #${linked.number}` : `PR #${on.number}${on.state === null ? "" : ` · ${on.state}`}`}
              <ArrowUpRightIcon aria-hidden className="size-3" />
            </a>
          </>
        )}
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
export function SteerCompose({
  words,
  setWords,
  steer,
  placeholder,
  quickReplies,
}: {
  words: string;
  setWords: (words: string) => void;
  steer: (message: string) => Promise<void>;
  placeholder?: string;
  /** Lines one press sends as they are, shown under the box. */
  quickReplies?: readonly string[];
}) {
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (quick?: string) => {
    const message = (quick ?? words).trim();
    if (message === "" || pending) return;
    setPending(true);
    setSaid(null);
    try {
      await steer(message);
      // A quick reply leaves what was typed in the box.
      if (quick === undefined) setWords("");
      setSaid({ ok: true, text: "Sent to the task." });
    } catch (error) {
      setSaid({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-label="Steer" className="flex flex-col gap-2 py-1">
      {/* One line tall, as the composer: the box grows with what is typed, up to a limit, then scrolls. */}
      <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-card p-1.5 pl-2 focus-within:border-ring">
        <textarea
          aria-label="Steer this task"
          data-testid="task-action-steer-input"
          value={words}
          rows={1}
          disabled={pending}
          placeholder={placeholder ?? "Steer this task: what to do differently, or what else it should know"}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="block field-sizing-content max-h-40 min-h-8 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-1.5 text-sm leading-5 outline-none placeholder:text-text-3"
        />
        <button
          type="button"
          data-testid="task-action-steer"
          aria-label={pending ? "Sending…" : "Send"}
          title={pending ? "Sending…" : "Send"}
          disabled={pending || words.trim() === ""}
          onClick={() => void send()}
          className="h-8 shrink-0 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Send
        </button>
      </div>
      {quickReplies === undefined || quickReplies.length === 0 ? null : (
        <div aria-label="Quick replies" role="group" className="flex flex-wrap gap-1.5">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              disabled={pending}
              onClick={() => void send(reply)}
              className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-text-2 hover:bg-accent hover:text-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {reply}
            </button>
          ))}
        </div>
      )}
      {said === null ? null : (
        <p role={said.ok ? "status" : "alert"} data-testid={said.ok ? "task-action-outcome" : "task-action-refusal"} className={cn("text-xs", said.ok ? "text-muted-foreground" : "text-destructive")}>
          {said.text}
        </p>
      )}
    </section>
  );
}
