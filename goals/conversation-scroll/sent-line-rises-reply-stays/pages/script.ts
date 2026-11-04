/**
 * The scripted conversations every goal page draws: no server, no model.
 *
 * Copied into each app's scratch copy at `src/goal/script.ts` and imported by
 * that app's page. Two conversations, `a` and `b`, each with enough history to
 * overflow its feed. A send lands the person's line after a short delay (as a
 * server's echo does), then streams a reply into one growing worker line, a
 * sentence at a time, slowly enough for the check to measure between chunks.
 *
 * The run drives it through `window.goal`:
 *
 *   goal.reply("short" | "long")   the next reply's length (default "short")
 *   goal.send(text)                send as the app's own composer would, for a
 *                                  surface whose composer the page doesn't mount
 *   goal.stream()                  the open conversation's worker starts writing,
 *                                  with nothing sent (a surface that never sends)
 *   goal.background()              a line that isn't the person's lands
 *   goal.switch()                  show the other conversation
 *   goal.busy()                    a reply is still streaming
 */
import { useSyncExternalStore } from "react";

export type Line = { id: string; who: "person" | "worker" | "other"; text: string; streaming?: boolean };
export type Conversation = { key: string; lines: Line[]; running: boolean };

const SHORT = ["Sure, done.", " That's all it needed."];
const LONG = Array.from(
  { length: 72 },
  (_, i) => `${i % 4 === 0 && i > 0 ? "\n\n" : " "}Sentence ${i + 1} of a long answer, streamed in slowly so a reader can follow it from its first word.`,
);
/** How long a sent line takes to come back, and the gap between reply chunks, in ms. */
const ECHO_MS = 150;
const FIRST_CHUNK_MS = 400;
const CHUNK_MS = 70;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function history(key: string): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < 14; i++) {
    lines.push({ id: `${key}-h${i}-p`, who: "person", text: `Earlier question ${i + 1} in conversation ${key}.` });
    lines.push({
      id: `${key}-h${i}-w`,
      who: "worker",
      text: `Earlier answer ${i + 1} in conversation ${key}. It runs to a few sentences, so the history is taller than the view. Another sentence here. And one more to fill the line out.`,
    });
  }
  return lines;
}

const conversations = new Map<string, Conversation>([
  ["a", { key: "a", lines: history("a"), running: false }],
  ["b", { key: "b", lines: history("b"), running: false }],
]);
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

let replyKind: "short" | "long" = "short";
let open = "a";
let streaming = 0;

/** Re-read a conversation as a new object, so React sees it change. */
function touch(key: string, edit: (c: Conversation) => Conversation) {
  conversations.set(key, edit(script.get(key)));
  changed();
}

/** Stream a reply into `key`: one worker line that grows a chunk at a time. */
function streamReply(key: string) {
  const chunks = replyKind === "long" ? LONG : SHORT;
  const id = nextId("reply");
  streaming++;
  touch(key, (c) => ({ ...c, running: true }));
  let i = 0;
  const tick = () => {
    const chunk = chunks[i++]!;
    touch(key, (c) => {
      const has = c.lines.some((l) => l.id === id);
      const lines = has
        ? c.lines.map((l) => (l.id === id ? { ...l, text: l.text + chunk, streaming: i < chunks.length } : l))
        : [...c.lines, { id, who: "worker" as const, text: chunk.trimStart(), streaming: i < chunks.length }];
      return { ...c, lines, running: i < chunks.length };
    });
    if (i < chunks.length) setTimeout(tick, CHUNK_MS);
    else streaming--;
  };
  setTimeout(tick, FIRST_CHUNK_MS);
}

export const script = {
  get(key: string): Conversation {
    if (!conversations.has(key)) conversations.set(key, { key, lines: history(key), running: false });
    return conversations.get(key)!;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The person sent `text` into `key`: it lands a moment later, then the reply streams in. */
  send(key: string, text: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        touch(key, (c) => ({ ...c, running: true, lines: [...c.lines, { id: nextId("line"), who: "person", text }] }));
        streamReply(key);
        resolve();
      }, ECHO_MS);
    });
  },
  /** A conversation with nothing in it yet, as one a first line opens. */
  create(key: string): void {
    conversations.set(key, { key, lines: [], running: false });
    changed();
  },
  get open(): string {
    return open;
  },
};

/** What the page tells the run: which conversation is open, and how to change it. */
export function exposeGoal(hooks: { send?: (text: string) => void; switched?: (key: string) => void } = {}) {
  (window as unknown as { goal: unknown }).goal = {
    reply(kind: "short" | "long") {
      replyKind = kind;
    },
    send(text: string) {
      if (hooks.send === undefined) throw new Error("this surface sends through its own composer");
      hooks.send(text);
    },
    stream() {
      streamReply(open);
    },
    background() {
      touch(open, (c) => ({
        ...c,
        lines: [
          ...c.lines,
          {
            id: nextId("other"),
            who: "other",
            text: "A line from someone else lands. ".repeat(30),
          },
        ],
      }));
    },
    switch() {
      open = open === "a" ? "b" : "a";
      hooks.switched?.(open);
      changed();
    },
    busy: () => streaming > 0,
    ready: true,
  };
}

/** The open conversation's key, as React state. */
export const useOpen = (): string => useSyncExternalStore(script.subscribe, () => open);

/** A conversation, as React state. */
export const useConversation = (key: string): Conversation => useSyncExternalStore(script.subscribe, () => script.get(key));
