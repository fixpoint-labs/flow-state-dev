/**
 * The Teammates lab's screen half, out of a browser, for a goal that grades
 * what the page reads: its `AppProvider` over a client, a follower per
 * conversation the goal watches (`ConversationFollower`, as the page mounts
 * one per teammate), and the conversation's calls, rendered by react-dom over
 * happy-dom. Each view a follower reads is what every screen on that
 * conversation draws.
 */
import { createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import type { Client, SessionConnectionStatus } from "@flow-state-dev/client";
import { AppProvider, ConversationFollower, useAppClient, useConversationCalls } from "../../labs/teammates/src/app/index.ts";
import type { ConversationView } from "../../labs/teammates/src/lib/conversation.ts";
import type { AppConnection } from "../../labs/teammates/src/lib/files.ts";

/** The screen half: the conversation's calls, a watch on a conversation, and the stop. */
export interface TeammatesScreen {
  calls: ReturnType<typeof useConversationCalls>;
  /** Each view conversation `sessionId`'s follower reads, and its connection; its follower is mounted from the first watch on. */
  watch(sessionId: string, on: (view: ConversationView, connection: SessionConnectionStatus) => void): () => void;
  close(): void;
}

/** The lab's provider over `client` (and `connection`, for a line's files), drawn, once it has drawn. */
export async function teammatesScreen(client: Client, connection?: AppConnection): Promise<TeammatesScreen> {
  if (typeof globalThis.document === "undefined") {
    const happy = new Window();
    Object.assign(globalThis, { window: happy, document: happy.document });
  }
  // Driven from outside React, as the host's answers arrive: no act() to wrap them in.
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  let held: { app: ReturnType<typeof useAppClient>; calls: ReturnType<typeof useConversationCalls> } | undefined;
  let follow: (ids: string[]) => void = () => {};
  const followed: string[] = [];
  function Probe() {
    const [ids, setIds] = useState<string[]>([]);
    follow = setIds;
    held = { app: useAppClient(), calls: useConversationCalls() };
    return createElement(Fragment, null, ...ids.map((id) => createElement(ConversationFollower, { key: id, sessionId: id })));
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  root.render(createElement(AppProvider, { client, ...(connection === undefined ? {} : { connection }) }, createElement(Probe)));
  for (let i = 0; i < 200 && held === undefined; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (held === undefined) throw new Error("the Teammates provider never drew");
  const drawn = held;
  return {
    calls: drawn.calls,
    watch(sessionId, on) {
      if (!followed.includes(sessionId)) {
        followed.push(sessionId);
        follow([...followed]);
      }
      let last: unknown;
      const tell = () => {
        const read = drawn.app.conversations.read(sessionId);
        if (read?.view === undefined || read === last) return;
        last = read;
        on(read.view, read.connection);
      };
      const stop = drawn.app.conversations.subscribe(tell);
      tell();
      return stop;
    },
    close: () => root.unmount(),
  };
}
