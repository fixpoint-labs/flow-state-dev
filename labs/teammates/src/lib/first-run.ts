/**
 * What an empty conversation says and offers (FIX-2403), from what the page
 * read: the roster and the lab's context. No worker, file or project is named
 * here that wasn't read.
 */
import type { LabContext, LabWorker } from "../adapter";

/** The workers `worker` hands work to, by name: its declared delegates, from the roster as read. */
export function delegatesOf(worker: LabWorker, workers: readonly LabWorker[], context: LabContext | undefined): LabWorker[] {
  const declared = context?.delegates[worker.id];
  if (declared === undefined) return [];
  const others = workers.filter((w) => w.id !== worker.id);
  return declared === "all" ? others : others.filter((w) => declared.includes(w.id));
}

/** A list as a person says it: "a", "a and b", "a, b and c". */
function spoken(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The empty conversation's sentence: who the worker is, and who it hands work to when it has delegates. */
export function emptyLine(worker: LabWorker, delegates: readonly LabWorker[]): string {
  if (delegates.length === 0) return `Say hello to ${worker.name}. This is your one conversation with it.${worker.role === "" ? "" : ` ${worker.role}`}`;
  const talkers = delegates.filter((w) => !w.takesTasks).map((w) => w.name);
  const coders = delegates.filter((w) => w.takesTasks).map((w) => w.name);
  const parts = [
    ...(talkers.length > 0 ? [`asks ${spoken(talkers)}`] : []),
    ...(coders.length > 0 ? [`starts coding tasks on ${spoken(coders)}`] : []),
  ];
  return `${worker.name} runs the work with you: it ${spoken(parts)}. This is your one conversation with it.`;
}

/** Lines the empty conversation offers; a click puts one in the composer and nothing is sent. */
export function starterLines(worker: LabWorker, delegates: readonly LabWorker[]): string[] {
  const talker = delegates.find((w) => !w.takesTasks);
  const coder = delegates.find((w) => w.takesTasks);
  if (delegates.length === 0) return ["What can you help me with?", "What have you worked on so far?"];
  return [
    "What can the team do for me?",
    ...(talker === undefined ? [] : [`Ask ${talker.name} to look into something for me`]),
    ...(coder === undefined ? [] : [`Have ${coder.name} make a small change in the working folder`]),
  ];
}
