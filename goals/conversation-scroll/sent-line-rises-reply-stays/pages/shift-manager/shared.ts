/**
 * Shift Manager's reads and sends, scripted. The goal page's build swaps
 * `src/lib/{lab-data,conversation,send,task,run}.ts` for the modules in
 * `fakes/`, which keep every other export of the real module and replace
 * only what talks to the Lab: the conversation and the run come from
 * `script.ts`, and a line sent goes into it.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { useSyncExternalStore } from "react";
import { script, type Line } from "../script";

/** A scripted line as the item the Lab would store for it. */
export const itemOf = (line: Line, index: number): OutputItem =>
  ({
    id: line.id,
    type: "message",
    role: line.who === "person" ? "user" : "assistant",
    status: line.streaming ? "in_progress" : "completed",
    requestId: "r",
    itemIndex: 0,
    ts: index,
    content: [{ type: "output_text", text: line.text }],
  }) as unknown as OutputItem;

export const itemsOf = (key: string): OutputItem[] => script.get(key).lines.map(itemOf);

/** The task's sends, as the task frame's composer counts them. */
let sent: string[] = [];
const listeners = new Set<() => void>();
export const sends = {
  add() {
    sent = [...sent, `sent-${sent.length + 1}`];
    for (const l of listeners) l();
  },
  use: () =>
    useSyncExternalStore(
      (l) => (listeners.add(l), () => listeners.delete(l)),
      () => sent,
    ),
};
