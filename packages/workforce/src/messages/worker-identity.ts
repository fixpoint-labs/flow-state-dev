/**
 * The default layer of a worker's prompt (FIX-2334): what every worker on the
 * built-in worker flow is told first, before its team, its own file and its
 * packages (contract C1, `docs/architecture/workforce-default-worker-flow.md`).
 *
 * Two pieces, in order: who the worker is and who it can reach, read from the
 * roster each request; then one rule on using tools. Fixed framework text: an
 * app that wants other words registers its own `agent` worker flow.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerInstallation } from "../workers/installation";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import { SEND_MESSAGE_TOOL } from "./keys";
import { rosterDisplayName, rosterTeamName, workerRecipients } from "./recipients";

/** The longest description the layer quotes for one worker. */
const MAX_DESCRIPTION = 160;

/** The layer's second piece: one general rule, naming no tool. */
export const TOOL_USE_RULE =
  "Use your tools to do what you're asked before you answer. Don't offer to do something you can do now: do it.";

/** Marks a teammate that is also the worker's delegate. */
export const DELEGATE_MARK = "(your delegate: takes your tasks too)";

/** How a worker splits a delegate's work between a message and a task. */
export const DELEGATE_RULE =
  "A message to a delegate is for a quick question. A piece of work for one, or anything to run in the background, goes as a task: createTask, its id as the assignee.";

const oneLine = (text: string | null): string => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…` : flat;
};

/**
 * The running worker's default layer, or `undefined` when the turn runs no
 * roster worker (so the prompt slot drops it, never a blank line).
 */
export async function workerIdentityPrompt(ctx: BlockContext, installation: WorkerInstallation): Promise<string | undefined> {
  const self = (ctx.session.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
  if (typeof self !== "string") return undefined;
  const { self: me, messageable, taskOnly } = await workerRecipients(ctx, installation, self);
  if (me === undefined) return undefined;

  const name = rosterDisplayName(me);
  const team = rosterTeamName(me);
  const role = oneLine(me.description);
  const lines = [
    `You are ${name}${team === undefined ? "" : `, on the ${team} team`}.` +
      (role === "" ? "" : ` Your role, as the people you work with read it: ${role}`),
    `When someone asks who you are, answer as ${name}, with this role. Your worker id, ${me.id}, is the address others reach you by, not your name.`
  ];

  // Only a worker's delegates take its tasks (the board checks an assignee
  // against them), so only they are named as ones to file a task with.
  // `createTask` unsuffixed: Workforce's conversation board mounts the task
  // tools with no `nameSuffix`, so a worker on this flow always sees that name.
  const delegates = me.delegates;
  const isDelegate = (worker: (typeof taskOnly)[number]) => delegates === "all" || delegates.includes(worker.id);
  const entry = (worker: (typeof messageable)[number]) => {
    const description = oneLine(worker.description);
    return `- ${rosterDisplayName(worker)} (${worker.id})${description === "" ? "" : `: ${description}`}`;
  };
  // A messageable delegate takes tasks too. Listed only as one to message, it
  // gets whole pieces of work as messages, which no board row tracks.
  const teammate = (worker: (typeof messageable)[number]) => (isDelegate(worker) ? `${entry(worker)} ${DELEGATE_MARK}` : entry(worker));
  lines.push(
    "",
    messageable.length === 0
      ? "No other worker on your roster can be messaged now."
      : `Your teammates, read from your roster this turn (asked who your teammates or delegates are, answer from this list: it is current, so no tool call is needed), whom you can message with ${SEND_MESSAGE_TOOL} by id:\n${messageable.map(teammate).join("\n")}`
  );
  if (messageable.some(isDelegate)) lines.push("", DELEGATE_RULE);
  const fileable = taskOnly.filter(isDelegate);
  const others = taskOnly.filter((worker) => !isDelegate(worker));
  if (fileable.length > 0) {
    lines.push(
      "",
      `Workers that take tasks only, not messages. File one a task with createTask, its id as the assignee:\n${fileable.map(entry).join("\n")}`
    );
  }
  if (others.length > 0) {
    lines.push(
      "",
      `Workers that take tasks only, not messages, filed by the workers they report to, not by you:\n${others.map(entry).join("\n")}`
    );
  }
  lines.push("", TOOL_USE_RULE);
  return lines.join("\n");
}
