/**
 * Headless verbs. Same actions as the TUI, printed and exited.
 *
 * `watch` re-runs `status` — it does not invent a second read. Exit codes:
 *   0  every named row is completed
 *   1  empty / errored / cancelled / last attempt failed / a call failed
 *   2  at least one open question
 *   3  still running or pending, no question and no failed attempt
 */
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  abortConductorRequest,
  answerQuestion,
  readBoard,
  seedIssue,
  steerInput,
  wakeBoard,
  runConductorAction,
  type ConductorDispatch,
} from "./dispatch";
import { HELP_TEXT } from "./parse";
import { renderBoardPlain, renderWatchLine, watchExitCode } from "./render";
import { createStreamTranscript, viewFromEvents } from "./transcript";
import { createChildFollow } from "./follow";
import {
  rowFailed,
  rowRunning,
  runningRequestIds,
  settledRequestIds,
  type OperatorCommand,
  type StatusRow,
  type ViewState,
} from "./types";

export interface HeadlessOptions {
  dispatch: ConductorDispatch;
  command: OperatorCommand;
  json: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
}

export async function runConductorHeadless(options: HeadlessOptions): Promise<number> {
  const out = options.stdout ?? process.stdout;
  const err = options.stderr ?? process.stderr;
  const write = (text: string) => {
    out.write(text.endsWith("\n") ? text : `${text}\n`);
  };
  const transcript = createStreamTranscript();
  const writeEvent = (text: string) => {
    err.write(text.endsWith("\n") ? text : `${text}\n`);
  };
  const onEvent = (event: RequestStreamEventWithId) => {
    if (options.json) return;
    const patch = transcript.apply(event);
    for (const line of patch.lines) writeEvent(line);
  };
  const flushTranscript = () => {
    if (options.json) return;
    const leftover = transcript.flush();
    for (const line of leftover.lines) writeEvent(line);
  };
  const follow = createChildFollow({ stores: options.dispatch.stores, onEvent });

  try {
    switch (options.command.kind) {
      case "help":
        write(HELP_TEXT);
        return 0;
      case "quit":
      case "refresh":
      case "find":
        write("that verb is TUI-only — run `fsdev conductor` with no verb");
        return 1;
      case "status": {
        const status = await readBoard(options.dispatch, options.command.issue, onEvent);
        if (options.command.issue !== undefined && !options.json) {
          await follow.drain(settledRequestIds(status.rows));
        }
        flushTranscript();
        const views = await attemptViews(options, status.rows, options.command.issue);
        write(renderBoardPlain(status.rows, options.json, views));
        return watchExitCode(status.rows);
      }
      case "seed": {
        const seeded = await seedIssue(
          options.dispatch,
          options.command.issue,
          options.command.phase,
          onEvent,
          options.command.brief,
        );
        flushTranscript();
        if (options.json) write(JSON.stringify(seeded));
        else write(`seeded ${options.command.issue} → ${seeded.taskId}`);
        const status = await readBoard(options.dispatch, options.command.issue, onEvent);
        flushTranscript();
        if (!options.json) {
          const views = await attemptViews(options, status.rows, options.command.issue);
          write(renderBoardPlain(status.rows, false, views));
        }
        return 0;
      }
      case "wake": {
        await wakeBoard(options.dispatch, onEvent);
        flushTranscript();
        const status = await readBoard(options.dispatch, undefined, onEvent);
        flushTranscript();
        const views = await attemptViews(options, status.rows, undefined);
        write(renderBoardPlain(status.rows, options.json, views));
        return watchExitCode(status.rows);
      }
      case "answer": {
        const answered = await answerQuestion(
          options.dispatch,
          options.command.question,
          options.command.text,
          onEvent,
        );
        flushTranscript();
        if (options.json) write(JSON.stringify(answered));
        else {
          write(
            answered.result === "declined"
              ? `declined · ${answered.reason ?? "refused"}`
              : `${answered.result}${answered.drained ? " · drain ran" : ""}`,
          );
        }
        return answered.result === "declined" ? 1 : 0;
      }
      case "steer": {
        const steered = await runConductorAction<string>(
          options.dispatch,
          "steer",
          steerInput(options.command.message),
          onEvent,
        );
        flushTranscript();
        if (steered.error !== undefined) {
          write(steered.error);
          return 1;
        }
        const said =
          typeof steered.output === "string" && steered.output.trim() !== ""
            ? steered.output.trim()
            : "coordinator turn finished";
        if (options.json) write(JSON.stringify({ message: said }));
        else write(said);
        const status = await readBoard(options.dispatch, undefined, onEvent);
        flushTranscript();
        if (!options.json) {
          const views = await attemptViews(options, status.rows, undefined);
          write(renderBoardPlain(status.rows, false, views));
        }
        return watchExitCode(status.rows);
      }
      case "abort": {
        const before = await readBoard(options.dispatch, options.command.issue, onEvent);
        flushTranscript();
        const ids = runningRequestIds(before.rows);
        if (ids.length === 0) {
          write("nothing running to stop");
          return 1;
        }
        for (const id of ids) {
          const result = await abortConductorRequest(options.dispatch.stores, id);
          write(result === "signaled" ? `stop · ${id}` : `stop · ${id} was not running`);
        }
        const after = await readBoard(options.dispatch, options.command.issue, onEvent);
        flushTranscript();
        const views = await attemptViews(options, after.rows, options.command.issue);
        write(renderBoardPlain(after.rows, options.json, views));
        return watchExitCode(after.rows);
      }
      case "watch":
        return await watchBoard(options, options.command.issue, onEvent, flushTranscript, follow);
      case "start": {
        // Interactive start is handled by the command (seed, then TUI).
        // Headless start seeds and watches — same two actions, printed.
        const seeded = await seedIssue(
          options.dispatch,
          options.command.issue,
          options.command.phase,
          onEvent,
          options.command.brief,
        );
        flushTranscript();
        if (options.json) write(JSON.stringify(seeded));
        else write(`seeded ${options.command.issue} → ${seeded.taskId}`);
        return await watchBoard(options, options.command.issue, onEvent, flushTranscript, follow);
      }
    }
  } catch (error) {
    err.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    follow.stop();
  }
}

async function watchBoard(
  options: HeadlessOptions,
  issue: string | undefined,
  onEvent: (event: RequestStreamEventWithId) => void,
  flush: () => void,
  follow: ReturnType<typeof createChildFollow>,
): Promise<number> {
  const out = options.stdout ?? process.stdout;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollMs ?? 2_000;
  const max = options.maxPolls ?? Number.POSITIVE_INFINITY;
  let last = "";
  for (let i = 0; i < max; i++) {
    const status = await readBoard(options.dispatch, issue, onEvent);
    follow.sync(runningRequestIds(status.rows));
    flush();
    const views = await attemptViews(options, status.rows, issue);
    const rendered = options.json
      ? renderBoardPlain(status.rows, true, views)
      : renderWatchLine(status.rows, views);
    if (rendered !== last) {
      out.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
      last = rendered;
    }
    const code = watchExitCode(status.rows);
      if (code !== 3) {
      if (!options.json) {
        const settled = settledRequestIds(status.rows);
        const ids =
          issue !== undefined ? settled : settled.filter((id) => follow.followed(id));
        await follow.drain(ids);
        flush();
      }
      const exitViews = await attemptViews(options, status.rows, issue);
      if (
        !options.json &&
        (status.rows.some((r) => r.questions.length > 0) || status.rows.some(rowFailed))
      ) {
        out.write(renderBoardPlain(status.rows, false, exitViews));
      }
      return code;
    }
    await sleep(pollMs);
  }
  return 3;
}

/**
 * Fold journals so stdout can print what a row is doing.
 *
 * A named issue loads that attempt — last tool, files, hunk, todo —
 * whether it is still running or already settled. A full-board verb
 * loads **running** rows only: current action, not every settled
 * history. `--json` uses the same rule and adds those fields on the row.
 */
async function attemptViews(
  options: HeadlessOptions,
  rows: readonly StatusRow[],
  issue: string | undefined,
): Promise<Record<string, ViewState> | undefined> {
  const views: Record<string, ViewState> = {};
  for (const row of rows) {
    const id = row.run?.requestId;
    if (id === null || id === undefined || id === "") continue;
    if (issue === undefined && !rowRunning(row)) continue;
    const events = await options.dispatch.stores.request.getEvents(id);
    views[id] = viewFromEvents(events, row);
  }
  return Object.keys(views).length === 0 ? undefined : views;
}
