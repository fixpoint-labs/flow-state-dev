/**
 * A worker's one conversation, read and driven only through the packages.
 * One follower per open conversation (`ConversationFollower`) reads its items
 * on react's `useSessionFeed`, its turns on workforce's session turns view
 * (running, stopped, retryable, and `historyStart`, where the worker's window
 * began), the history summary's mark through `useResource` by session id, and
 * the roster, so a line under a worker's name reads as a task's ending. Every
 * screen on the conversation reads what it read (`useConversation`). Its
 * writes go through workforce's client (`useConversationCalls`): open it,
 * send a line (streamed into the follower's feed), stop it (`stopTurns`) and
 * retry a failed turn (`retryTurn`); an approval is answered by react's
 * `useApproval`, where its entry is drawn.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { UploadRequest } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { useResource, useSessionFeed, useView } from "@flow-state-dev/react";
import { historySummaryResource, rosterView, sessionTurnsViewRef } from "@flow-state-dev/workforce/browser";
import { answeringOf, RETRYABLE_SOURCES, toEntries, windowMarkOf, windowReadOf, type ConversationEntry, type ConversationView } from "../lib/conversation";
import { fileReader } from "../lib/files";
import type { Item } from "../lib/items";
import { reuseById } from "../lib/stable";
import { useAppClient } from "./provider";

/** How many turns workforce's session turns view lists: a session's newest. */
const TURNS_LISTED = 50;

/** Follows conversation `sessionId` for every screen on it: render one per open conversation. Draws nothing. */
export function ConversationFollower({ sessionId }: { sessionId: string }): null {
  const { client, pollIntervalMs, conversations } = useAppClient();
  const feed = useSessionFeed(sessionId, { client });
  const turns = useView(sessionTurnsViewRef(), { sessionId }, { client, pollIntervalMs }).value;
  const summary = useResource(historySummaryResource, { sessionId, client, pollIntervalMs }).value;
  const roster = useView(rosterView, undefined, { client, pollIntervalMs }).value;
  const stop = useSyncExternalStore(conversations.subscribe, () => conversations.stopOf(sessionId));
  // Kept for the follower's life: a stopped line stays once its turn leaves the turns read.
  const [stopped] = useState(() => new Set<string>());
  // Unchanged entries keep their objects, so a streamed chunk redraws only the growing one.
  const last = useRef<ConversationEntry[]>([]);
  const items = feed?.items as unknown as Item[] | undefined;
  const ended = useMemo(() => (turns ?? []).filter((t) => t.status !== "in_progress").map((t) => t.id), [turns]);
  // A stop ends once the turns show every turn it stopped ended. A full view (its newest fifty) that doesn't list
  // one has left it out as older; one listing fewer hasn't read it yet.
  const listed = new Set((turns ?? []).map((t) => t.id));
  const stopEnded = stop?.ids != null && [...stop.ids].every((id) => ended.includes(id) || (!listed.has(id) && listed.size >= TURNS_LISTED));
  const followed = useMemo(() => {
    if (feed === undefined) return undefined;
    // Before the history lands there is no view yet, but the connection is already news: a read that gave up is `stopped`.
    if (items === undefined) return { view: undefined, connection: feed.state, mark: undefined, follow: feed.followResponse };
    const read = turns ?? [];
    for (const turn of read) if (turn.status === "aborted") stopped.add(turn.id);
    const workers = new Set((roster ?? []).map((w) => w.id));
    // The turns the engine would retry for you; a turn that ended with a call still marked running reads that call failed.
    const retryable = new Set(read.filter((t) => RETRYABLE_SOURCES.has(t.source)).map((t) => t.id));
    const entries = (last.current = reuseById(last.current, toEntries(items, workers, ended, retryable, [...stopped])));
    const inProgress = read.filter((t) => t.status === "in_progress").map((t) => t.id);
    const since: number | undefined = items[0]?.ts;
    const view: ConversationView = {
      entries,
      running: answeringOf(items, inProgress, ended),
      stopping: stop !== undefined && !stopEnded,
      backgroundRunning: feed.runs === null ? null : feed.runs.length,
      ...(feed.hasEarlier ? { loadEarlier: feed.loadEarlier } : {}),
      ...(since === undefined ? {} : { since }),
    };
    return { view, connection: feed.state, mark: windowMarkOf(items, entries, windowReadOf(read, summary)), follow: feed.followResponse };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, feed?.state, feed?.runs, feed?.hasEarlier, turns, ended, summary, roster, stop, stopEnded]);
  useEffect(() => {
    if (stopEnded) conversations.setStop(sessionId, undefined, stop);
  }, [stopEnded, stop, conversations, sessionId]);
  useEffect(() => conversations.publish(sessionId, followed), [conversations, sessionId, followed]);
  useEffect(() => () => conversations.publish(sessionId, undefined), [conversations, sessionId]);
  return null;
}

/** What conversation `sessionId`'s follower read last: its view, connection and divider; `undefined` until it has. */
export function useConversation(sessionId: string | undefined) {
  const { conversations } = useAppClient();
  return useSyncExternalStore(conversations.subscribe, () => (sessionId === undefined ? undefined : conversations.read(sessionId)));
}

/** A conversation's writes, through workforce's client, and a line's files. The same object while the provider holds. */
export function useConversationCalls() {
  const { client, workforce, conversations, connection } = useAppClient();
  return useMemo(
    () => ({
      /** The worker's one conversation, by id: the same id every time. */
      async open(worker: string): Promise<string> {
        const session = await workforce.ensureWorkerSession({ worker });
        conversations.flows.set(session.id, session.flowId ?? session.flowKind);
        return session.id;
      },
      /** Send a line, with the files attached to it; with the conversation followed, its answer shows as it is written. */
      async send(sessionId: string, text: string, attachments: readonly FileContent[] = []): Promise<void> {
        const follow = conversations.read(sessionId)?.follow;
        if (follow === undefined) {
          await workforce.send(sessionId, text, { attachments: [...attachments] });
          return;
        }
        const response = await workforce.send(sessionId, text, { stream: true, attachments: [...attachments] });
        if (response.headers.get("content-type")?.includes("text/event-stream")) follow(response);
      },
      /**
       * Stop the turns running at the press, and every line sent before it; a line sent after it runs on
       * (workforce's `stopTurns`). Stopping shows from the press until each turn it stopped has ended.
       * Rejects with why the server refused one.
       */
      async stop(sessionId: string): Promise<void> {
        const reading = { ids: null };
        conversations.setStop(sessionId, reading);
        let ids: ReadonlySet<string>;
        try {
          ids = new Set(await workforce.stopTurns(sessionId));
        } catch (error) {
          conversations.setStop(sessionId, undefined, reading);
          throw error;
        }
        conversations.setStop(sessionId, ids.size === 0 ? undefined : { ids }, reading);
      },
      /** Run a failed turn again, as a new request the engine links to `requestId`. */
      retry: (sessionId: string, requestId: string): Promise<void> => workforce.retryTurn(sessionId, requestId),
      /** Store a file the composer attached; resolves to its reference, which a line then carries. */
      upload: (request: UploadRequest): Promise<FileContent> => client.upload(request),
      /** The bytes of a file a line carries, for its thumbnail. */
      readFile: fileReader(connection),
    }),
    [client, workforce, conversations, connection],
  );
}
