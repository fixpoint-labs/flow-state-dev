/**
 * The project level (BR-22 to BR-31): a project of the organization's, or No
 * project, in four tabs.
 *
 * - **Stream** is the project's room, reached through the viewer's own talk
 *   session (`talkFor`, then `talk.ts`): read on open, on focus, and after the
 *   viewer's own post has woken the room's seats. Another member's line shows
 *   on the next read, not live. A member with no talk session gets Join; the
 *   owner of a project whose mint failed is joined on open; someone who is not
 *   a member is told the room is for its members.
 * - **Board** draws one lane per workstream of the project that holds a
 *   board, in the workstream Board's columns.
 * - **Workstreams** lists the workstreams the project's row names, each
 *   linking to its own level. One whose channel has left the tree is shown as
 *   gone, with no link.
 * - **Brief** is the row's brief.
 *
 * No project holds the workstreams no project lists (D3): its Board and
 * Workstreams list them, and it has no room and no brief.
 *
 * Everything but the room comes from the one snapshot. The room is never part
 * of it: it is read only when a member opens it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import { Board } from "../components/Board";
import { EmptyState, SectionFailure, Tabs } from "../components/ui";
import { mergeLines } from "../lib/transcript";
import { projectsOf, talkFor, teamsOf, type ListedWorkstream, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure, type Project, type Workstream } from "../lib/reads";
import { navigate, NO_PROJECT, PROJECT_TABS, type ProjectTab } from "../lib/routes";
import { asTranscriptLine, joinRoom, postToRoom, readRoom, settled } from "../lib/talk";
import type { Gaps } from "../gaps";
import { Composer, TranscriptLines } from "./Stream";

export function ProjectView({
  snapshot,
  projectId,
  tab,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  projectId: string;
  tab: ProjectTab;
  gaps: Gaps;
}) {
  const { refresh } = useLab();
  const teams = snapshot.inventory.ok ? teamsOf(snapshot.inventory.value.seats) : [];
  const view = projectsOf(snapshot);

  let title = "No project";
  let body: ReactNode;
  if (!view.ok) {
    body = (
      <div className="p-4">
        <SectionFailure what="Projects" failure={view.failure} onRetry={() => void refresh()} testId="project-failure" />
      </div>
    );
  } else if (projectId === NO_PROJECT) {
    const listed = view.value.noProject.map((workstream) => ({ id: workstream.id, workstream }));
    body =
      tab === "stream" ? (
        <EmptyState title="No project has no room" testId="project-stream-none">
          A room belongs to a project. These workstreams are in no project, so there is nothing to read or post here.
          Each workstream has its own Stream.
        </EmptyState>
      ) : tab === "brief" ? (
        <EmptyState title="No project has no brief" testId="project-brief-none">
          A brief belongs to a project. These workstreams are in no project.
        </EmptyState>
      ) : tab === "board" ? (
        <Lanes snapshot={snapshot} listed={listed} gaps={gaps} />
      ) : (
        <WorkstreamList listed={listed} />
      );
  } else {
    const group = view.value.projects.find((g) => g.project.id === projectId);
    if (group === undefined) {
      title = projectId;
      body = (
        <EmptyState title="No such project" testId="project-missing">
          This Lab has no project "{projectId}".{" "}
          <button
            type="button"
            className="underline"
            data-testid="project-missing-link"
            onClick={() => navigate({ level: "project", projectId: NO_PROJECT, tab: "workstreams" })}
          >
            See the Lab's workstreams
          </button>
          , or pick a project under PROJECTS.
        </EmptyState>
      );
    } else {
      title = group.project.title;
      const talkKind = snapshot.projects.ok ? snapshot.projects.value.talkKind : null;
      body =
        tab === "stream" ? (
          <ProjectStream key={group.project.id} project={group.project} talkKind={talkKind} />
        ) : tab === "brief" ? (
          group.project.brief === null ? (
            <EmptyState title="No brief" testId="project-brief-none">
              This project was created without a brief.
            </EmptyState>
          ) : (
            <article className="mx-auto w-full max-w-3xl overflow-y-auto whitespace-pre-wrap p-6 text-sm" data-testid="project-brief">
              {group.project.brief}
            </article>
          )
        ) : tab === "board" ? (
          <Lanes snapshot={snapshot} listed={group.workstreams} gaps={gaps} />
        ) : (
          <WorkstreamList listed={group.workstreams} />
        );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project" data-project-id={projectId}>
      <header className="flex items-end justify-between px-4 pt-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">PROJECT</p>
          <h1 className="text-base font-semibold" data-testid="project-title">
            {title}
          </h1>
        </div>
        <ul className="flex gap-2 pb-1" data-testid="team-strip" aria-label="Teams">
          {teams.map(({ team, seats }) => (
            <li key={team} className="rounded-full border px-2 py-0.5 text-xs">
              {team} <span className="text-muted-foreground">{seats.length}</span>
            </li>
          ))}
        </ul>
      </header>
      <Tabs label="Project" tabs={PROJECT_TABS} selected={tab} onSelect={(next) => navigate({ level: "project", projectId, tab: next })} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="tabpanel" data-tabpanel={tab}>
        {body}
      </div>
    </div>
  );
}

/** Each listed workstream, linking to it; one that left the tree, as gone (BR-27). */
function WorkstreamList({ listed }: { listed: readonly ListedWorkstream[] }) {
  if (listed.length === 0) {
    return (
      <EmptyState title="No workstreams" testId="project-workstreams-none">
        No workstream is listed here yet.
      </EmptyState>
    );
  }
  return (
    <ul className="mx-auto w-full max-w-3xl space-y-1 p-4" data-testid="project-workstreams">
      {listed.map(({ id, workstream }) => (
        <li key={id} data-testid="project-workstream" data-channel-id={id} data-gone={workstream === undefined ? "true" : undefined}>
          {workstream === undefined ? (
            <span className="text-sm text-muted-foreground">
              {id} · no longer in the Lab
            </span>
          ) : (
            <button
              type="button"
              className="text-sm underline-offset-2 hover:underline"
              onClick={() => navigate({ level: "workstream", channelId: workstream.id, tab: "stream" })}
            >
              {workstream.id}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One lane per listed workstream that holds a board, in the workstream Board's columns (BR-26). */
function Lanes({ snapshot, listed, gaps }: { snapshot: LoadedSnapshot; listed: readonly ListedWorkstream[]; gaps: Gaps }) {
  const { refresh } = useLab();
  const lanes = listed.flatMap(({ workstream }): Workstream[] => {
    if (workstream === undefined) return [];
    const boards = snapshot.boards[workstream.id];
    return boards !== undefined && (!boards.ok || boards.value.refs.length > 0) ? [workstream] : [];
  });
  if (lanes.length === 0) {
    return (
      <EmptyState title="No board" testId="project-board-none">
        None of these workstreams holds a board, so there are no tasks to show.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="project-board">
      {lanes.map((workstream) => {
        const boards = snapshot.boards[workstream.id]!;
        return (
          <section key={workstream.id} data-testid="project-lane" data-channel-id={workstream.id}>
            <h3 className="px-4 pt-3 text-xs font-medium">{workstream.id}</h3>
            {boards.ok ? (
              <Board rows={boards.value.rows} inReviewGap={gaps.inReview} />
            ) : (
              <div className="p-4">
                <SectionFailure what={`${workstream.id}'s boards`} failure={boards.failure} onRetry={() => void refresh()} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The project's room, as this person reaches it (BR-23, BR-24). */
function ProjectStream({ project, talkKind }: { project: Project; talkKind: string | null }) {
  const { clients, refresh } = useLab();
  const talk = talkFor(project, clients.userId);
  const [joining, setJoining] = useState<{ failure: Failure } | "running" | undefined>(undefined);

  const join = useCallback(async () => {
    if (talkKind === null) return;
    setJoining("running");
    try {
      await joinRoom(clients, talkKind, project.id);
      // The row now lists this person's talk session; the next snapshot draws it.
      await refresh();
      setJoining(undefined);
    } catch (error) {
      setJoining({ failure: describeFailure(error) });
    }
  }, [clients, project.id, refresh, talkKind]);

  // An owner the mint at create missed is bound on open (BR-8a).
  const repaired = useRef(false);
  useEffect(() => {
    if (talk.kind !== "repair" || repaired.current) return;
    repaired.current = true;
    void join();
  }, [join, talk.kind]);

  if (talk.kind === "outsider") {
    return (
      <EmptyState title="This room is for the project's members" testId="project-stream-members-only">
        You can see that this project exists and what it holds. Only its members read and post its conversation.
      </EmptyState>
    );
  }
  if (talkKind === null) {
    return (
      <EmptyState title="No room to read" testId="project-stream-no-kind">
        None of this Lab's flows you hold a session on serves project rooms, so there is no way in from here.
      </EmptyState>
    );
  }
  if (typeof joining === "object") {
    return (
      <div className="p-4">
        <SectionFailure what="Joining the room" failure={joining.failure} onRetry={() => void join()} testId="project-join-failure" />
      </div>
    );
  }
  if (talk.kind === "repair" || joining === "running") {
    return <p className="p-4 text-sm text-muted-foreground" data-testid="project-joining">Opening your conversation…</p>;
  }
  if (talk.kind === "join") {
    return (
      <EmptyState title="You haven't joined this room" testId="project-stream-join">
        You're a member of this project. Join to read and post its conversation.{" "}
        <button type="button" className="underline" data-testid="project-join" onClick={() => void join()}>
          Join
        </button>
      </EmptyState>
    );
  }
  return <Room key={talk.sessionId} sessionId={talk.sessionId} talkKind={talkKind} />;
}

/**
 * The room through one talk session: read by cursor on open, on focus, and
 * after this person's post has woken the room's seats. The cursor lives in the
 * view; nothing about it is stored.
 */
function Room({ sessionId, talkKind }: { sessionId: string; talkKind: string }) {
  const { clients } = useLab();
  const [lines, setLines] = useState<ChannelTranscriptLine[] | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const cursor = useRef(0);
  const reading = useRef<Promise<void> | undefined>(undefined);

  /** Read every page after the cursor. One read at a time; a second call waits for the first. */
  const readNew = useCallback(async () => {
    const previous = reading.current;
    const next = (async () => {
      await previous;
      try {
        for (;;) {
          const page = await readRoom(clients, talkKind, sessionId, cursor.current);
          const fresh = page.lines.map(asTranscriptLine);
          setLines((held) => mergeLines(held ?? [], fresh));
          if (page.nextCursor <= cursor.current) break;
          cursor.current = page.nextCursor;
          if (page.lines.length === 0) break;
        }
        setFailure(undefined);
      } catch (error) {
        setFailure(describeFailure(error));
      }
    })();
    reading.current = next;
    await next;
  }, [clients, sessionId, talkKind]);

  useEffect(() => {
    void readNew();
    const onFocus = () => void readNew();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readNew]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stream" data-talk-session={sessionId}>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="transcript">
        {failure !== undefined && lines === undefined ? (
          <div className="p-4">
            <SectionFailure what="The room" failure={failure} onRetry={() => void readNew()} testId="room-failure" />
          </div>
        ) : lines === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Reading the room…</p>
        ) : (
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
            <TranscriptLines lines={lines} />
            {lines.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">Nothing has been posted in this room yet.</li>
            ) : null}
            <li className="text-xs text-muted-foreground" data-testid="room-note">
              Other members' lines show when you come back to this tab or post.
            </li>
          </ol>
        )}
      </div>
      <Composer
        key={sessionId}
        label="Post to this project's room"
        placeholder="Post a line to the project's room…"
        send={(body) => postToRoom(clients, talkKind, sessionId, body)}
        onKept={async () => {
          await readNew();
          // The post woke the room's seats; their answers land in the room.
          await settled(clients, sessionId);
          await readNew();
        }}
      />
    </div>
  );
}
