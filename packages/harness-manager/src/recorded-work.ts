/**
 * What a coding run recorded: its plan, the files its file tools touched, and
 * the pull requests it opened, read from the run session's recorded
 * collections by the run's session and request.
 *
 * A browser read: it goes through the API client's resource reads and nothing
 * else, so an app's task view and any other page can show the same rows
 * without re-parsing the run's steps. Exported from
 * `@flow-state-dev/harness-manager/browser`.
 *
 * A read that fails throws the client's own error unchanged; the caller words
 * it for its own screen.
 */
import type { ResourceManifest, ResourcesApi } from "@flow-state-dev/client";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  OBSERVED_PULL_REQUESTS,
  planKeySegment,
  planRowsPrefix,
  readPlanTarget,
} from "@flow-state-dev/core/types";

/** The two resource reads this module makes: any `Client` from `@flow-state-dev/client` fits. */
export type RecordedWorkClient = { resources: Pick<ResourcesApi, "getResourceManifest" | "listCollectionItems"> };

/** The run to read: the session it ran in and the request that was the run. */
export type RecordedRun = { sessionId: string; requestId: string };

/**
 * The storage prefixes a coding harness records its plan, file operations and
 * pull requests under, when it records them. Found in the run session's
 * manifest by these patterns; a flow that declares none records none.
 */
const RECORDED = {
  plan: `${OBSERVED_PLAN}/**`,
  markers: `${OBSERVED_PLAN_LIST}/**`,
  files: "observed-file-ops/**",
  pullRequests: `${OBSERVED_PULL_REQUESTS}/**`,
} as const;

/** One step of the plan the run recorded. */
export type PlanStep = { id: string; title: string; status: string | null };
/** One path the run's file tools touched. */
export type FileTouch = { path: string; kind: "created" | "edited" | null };
/** One pull request the run opened, or found on its branch. */
export type OpenedPullRequest = {
  url: string;
  repository: string | null;
  number: number | null;
  title: string | null;
  state: string | null;
  source: "tool" | "branch" | null;
};

/** What a run recorded, per section: its rows, `null` when the harness records none. */
export type RecordedWork = {
  plan: { rows: PlanStep[]; truncated: boolean } | null;
  files: { rows: FileTouch[]; truncated: boolean } | null;
  pullRequests: { rows: OpenedPullRequest[]; truncated: boolean } | null;
};

/** Rows per recorded-collection read. One page; past it the section says there is more. */
const RECORDED_PAGE = 200;

function recordedRef(manifest: ResourceManifest, pattern: string): string | undefined {
  return manifest.resources.find((r) => r.kind === "collection" && r.pattern === pattern && r.client.state?.read === true)?.ref;
}

/**
 * The plan and files the run recorded, read once. File rows are keyed
 * `<request>/<invocation>/<path>`, so one prefix read selects everything this
 * request did and nothing an earlier run in the same session did. The plan is
 * the harness conversation's: the run leaves a pointer to it under its own
 * request, and a run from before plans were kept by conversation has its plan
 * under the request, as files are. Pull requests are keyed by the pull
 * request, not the request, since a session keeps one row per pull request
 * across its turns: each row names the request that opened it, and only this
 * run's are kept.
 */
export async function readRecordedWork(client: RecordedWorkClient, run: RecordedRun): Promise<RecordedWork> {
  const manifest = await client.resources.getResourceManifest(run.sessionId);
  // Escaped the way the recorder keys it, so a request id holding a `/` still selects its own rows.
  const underRequest = (pattern: string) => `${pattern.slice(0, -"/**".length)}/${planKeySegment(run.requestId)}/`;
  const read = async (pattern: string, prefix = underRequest(pattern)) => {
    const ref = recordedRef(manifest, pattern);
    if (ref === undefined) return null;
    const page = await client.resources.listCollectionItems(run.sessionId, ref, { limit: RECORDED_PAGE, topicPrefix: prefix });
    return { items: page.items, truncated: page.nextCursor != null };
  };
  const readPlan = async () => {
    if (recordedRef(manifest, RECORDED.plan) === undefined) return null;
    const pointers = await read(RECORDED.markers, planRowsPrefix(run.requestId, OBSERVED_PLAN_LIST));
    const markers = (pointers?.items ?? []).map((item) => ({
      topic: item.topic,
      conversation: field(item.clientData, "conversation") as string | null | undefined,
    }));
    return read(RECORDED.plan, readPlanTarget(run.requestId, markers).rowsPrefix);
  };
  const field = (data: unknown, key: string) => (data as Record<string, unknown> | undefined)?.[key];
  const [plan, files, pullRequests] = await Promise.all([
    readPlan(),
    read(RECORDED.files),
    read(RECORDED.pullRequests, `${OBSERVED_PULL_REQUESTS}/`),
  ]);
  const text = (data: unknown, key: string) => (typeof field(data, key) === "string" ? (field(data, key) as string) : null);
  /** The key segments after `<request>/<invocation>/`, or a plan's `conversation/<id>/`. */
  const rest = (topic: string) => topic.split("/").slice(2).join("/");
  return {
    plan:
      plan === null
        ? null
        : {
            truncated: plan.truncated,
            rows: plan.items.map((item) => ({
              id: rest(item.topic),
              title: typeof field(item.clientData, "title") === "string" ? (field(item.clientData, "title") as string) : rest(item.topic),
              status: typeof field(item.clientData, "status") === "string" ? (field(item.clientData, "status") as string) : null,
            })),
          },
    files:
      files === null
        ? null
        : {
            truncated: files.truncated,
            rows: files.items.map((item) => {
              const kind = field(item.clientData, "lastKind");
              return { path: rest(item.topic), kind: kind === "created" || kind === "edited" ? kind : null };
            }),
          },
    pullRequests:
      pullRequests === null
        ? null
        : {
            truncated: pullRequests.truncated,
            rows: pullRequests.items
              .filter((item) => field(item.clientData, "requestId") === run.requestId && text(item.clientData, "url") !== null)
              .sort((a, b) => Number(field(a.clientData, "firstSeenAt") ?? 0) - Number(field(b.clientData, "firstSeenAt") ?? 0))
              .map((item) => {
                const source = field(item.clientData, "source");
                const number = field(item.clientData, "number");
                return {
                  url: text(item.clientData, "url")!,
                  repository: text(item.clientData, "repository"),
                  number: typeof number === "number" ? number : null,
                  title: text(item.clientData, "title"),
                  state: text(item.clientData, "state"),
                  source: source === "tool" || source === "branch" ? source : null,
                };
              }),
          },
  };
}
