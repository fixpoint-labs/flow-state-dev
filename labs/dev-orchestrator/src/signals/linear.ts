/**
 * Deterministic Linear client for the orchestrator's own reads and writes.
 *
 * Completion detection and state transitions are NOT model decisions — the
 * orchestrator reads and moves the board through a typed, deterministic client.
 * (MCP stays the *dispatched agents'* conversational path; this is the
 * conductor's own hands.) The client is split into a narrow `LinearTransport`
 * seam — the three operations the orchestrator needs — and a thin transport
 * default. Tests drive a fake transport; the default talks to Linear's GraphQL
 * API. The default is exercised only by a live `babysit` smoke test, never in
 * CI, so the GraphQL shape is verified manually (per the spec's open question on
 * the Linear access path), while all orchestration logic above the seam is
 * fully unit-tested.
 */
import type { LinearStateName } from "../types";

/**
 * The minimal Linear surface the orchestrator depends on. Kept narrow on
 * purpose: a POC-local seam, not a general Linear client (that is out of scope
 * per the spec's non-goals).
 */
export interface LinearTransport {
  /** Current workflow-state name of an issue, or null if the issue is unknown. */
  getIssueState(issueId: string): Promise<string | null>;
  /** Move an issue to the named workflow state. */
  setIssueState(issueId: string, stateName: string): Promise<void>;
  /** Post a comment on an issue. */
  comment(issueId: string, body: string): Promise<void>;
}

/**
 * Deterministic read/transition/comment access to a single Linear issue.
 * Transitions are idempotent at this layer so the orchestrator can re-assert a
 * target state without caring whether a skill (or the human) already moved the
 * board there — observing the advanced state IS the completion signal.
 */
export class LinearStatusClient {
  constructor(private readonly transport: LinearTransport) {}

  /** Read the issue's current workflow state name (null if unknown). */
  async getState(issueId: string): Promise<LinearStateName | null> {
    return this.transport.getIssueState(issueId);
  }

  /**
   * Move the issue to `stateName`, skipping the write when it is already there.
   * Idempotent: safe to call when a dispatched skill or a human already
   * advanced the board, which is the common case the orchestrator tolerates.
   */
  async transitionTo(issueId: string, stateName: LinearStateName): Promise<void> {
    const current = await this.transport.getIssueState(issueId);
    if (current === stateName) return;
    await this.transport.setIssueState(issueId, stateName);
  }

  /** Post a comment to the issue timeline (observability surface). */
  async comment(issueId: string, body: string): Promise<void> {
    await this.transport.comment(issueId, body);
  }
}

/** Options for the GraphQL transport default. */
export interface LinearGraphQLTransportOptions {
  /** Linear API key (the POC reuses `LINEAR_MCP_API_KEY`). */
  apiKey: string;
  /** Override the fetch implementation (tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** Override the GraphQL endpoint. Defaults to Linear's public API. */
  endpoint?: string;
}

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

/**
 * Default `LinearTransport` backed by Linear's GraphQL API. Resolves an issue
 * by its human identifier (e.g. `FIX-832`), maps a target state *name* to the
 * team's workflow-state id, and issues the update / comment mutations. Not
 * unit-tested (it performs network I/O); its shape is validated by the manual
 * smoke test the spec calls for. Throws on any non-success GraphQL response so
 * failures surface to the driver rather than silently no-op'ing a transition.
 */
export function createLinearGraphQLTransport(
  options: LinearGraphQLTransportOptions,
): LinearTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? LINEAR_GRAPHQL_ENDPOINT;

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: options.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Linear GraphQL request failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors && json.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (json.data === undefined) {
      throw new Error("Linear GraphQL response had no data");
    }
    return json.data;
  }

  type IssueResolution = {
    issue: {
      id: string;
      state: { name: string } | null;
      team: { states: { nodes: { id: string; name: string }[] } };
    } | null;
  };

  async function resolveIssue(issueId: string): Promise<IssueResolution["issue"]> {
    const data = await gql<IssueResolution>(
      `query Issue($id: String!) {
         issue(id: $id) {
           id
           state { name }
           team { states(first: 100) { nodes { id name } } }
         }
       }`,
      { id: issueId },
    );
    return data.issue;
  }

  return {
    async getIssueState(issueId) {
      const issue = await resolveIssue(issueId);
      return issue?.state?.name ?? null;
    },

    async setIssueState(issueId, stateName) {
      const issue = await resolveIssue(issueId);
      if (issue === null) throw new Error(`Linear issue "${issueId}" not found`);
      const target = issue.team.states.nodes.find((s) => s.name === stateName);
      if (target === undefined) {
        throw new Error(`Linear workflow state "${stateName}" not found on the issue's team`);
      }
      await gql(
        `mutation Move($id: String!, $stateId: String!) {
           issueUpdate(id: $id, input: { stateId: $stateId }) { success }
         }`,
        { id: issue.id, stateId: target.id },
      );
    },

    async comment(issueId, body) {
      const issue = await resolveIssue(issueId);
      if (issue === null) throw new Error(`Linear issue "${issueId}" not found`);
      await gql(
        `mutation Comment($issueId: String!, $body: String!) {
           commentCreate(input: { issueId: $issueId, body: $body }) { success }
         }`,
        { issueId: issue.id, body },
      );
    },
  };
}
