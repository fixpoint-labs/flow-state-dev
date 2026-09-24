/**
 * Who a terminal run is — the one identity step `fsdev run` and `fsdev chat`
 * share (FIX-1551).
 *
 * The CLI does not answer this itself. It asks the app the question an HTTP
 * action request asks, through the engine's in-process entry point, so the
 * resolver precedence and organization rules are the app's own. `--org` skips
 * the ask; `--user` alone keeps the app's organization and replaces its user.
 * A refusal stops the command before anything is written.
 */
import { DEFAULT_ORG_ID, isValidOrgId } from "@flow-state-dev/core";
import type { InProcessPrincipal, InProcessPrincipalQuestion, StoreRegistry } from "@flow-state-dev/engine";
import { CliError } from "./resolve-block";
import { EXIT_CONFIG_ERROR, EXIT_INVALID_ARGS } from "./exit-codes";

/** The user a terminal names when `--user` is not given. */
const DEFAULT_CLI_USER = "cli-user";

/** Where a terminal run's identity came from, as `--capture` records it. */
export type CliPrincipalSource = "resolver" | "flag" | "development-default";

/** The identity one invocation (or one chat turn) runs under. */
export interface CliPrincipal {
  userId: string;
  orgId: string;
  from: CliPrincipalSource;
}

/** The identity flags a developer may pass. Only `run` and `chat` accept them. */
export interface PrincipalFlags {
  org?: string;
  user?: string;
}

/** Asks the app who an in-process caller is (`FlowState.resolveInProcessPrincipal`, or the bare-registry form). */
export type AskPrincipal = (question: InProcessPrincipalQuestion) => Promise<InProcessPrincipal>;

/**
 * Ask a loaded app's FlowState — its own answer, the one its HTTP routes give.
 * Refuses an app whose engine predates that answer rather than guessing an
 * organization for it.
 */
export function askFlowState(
  flowState: { resolveInProcessPrincipal?: AskPrincipal },
  configPath: string,
): AskPrincipal {
  if (typeof flowState.resolveInProcessPrincipal !== "function") {
    throw new CliError(
      `The FlowState in ${configPath} cannot say who a terminal run is: its @flow-state-dev/engine ` +
        `is older than this fsdev. Upgrade @flow-state-dev/engine to match.`,
      EXIT_CONFIG_ERROR,
    );
  }
  return (question) => flowState.resolveInProcessPrincipal!(question);
}

/**
 * Refuse identity flags that could never name a real caller, before anything
 * else runs. `--org` is held to the rule every organization id is, and may not
 * be the reserved development one — that id means "nobody authenticated",
 * which is what `--org` is for leaving.
 */
export function validatePrincipalFlags(flags: PrincipalFlags): void {
  if (flags.org !== undefined) {
    if (!isValidOrgId(flags.org)) {
      throw new CliError("--org must be a nonempty organization id.", EXIT_INVALID_ARGS);
    }
    if (flags.org === DEFAULT_ORG_ID) {
      throw new CliError(
        `--org "${DEFAULT_ORG_ID}" is the reserved development organization; ` +
          `omit --org to use it on an app with no resolver.`,
        EXIT_INVALID_ARGS,
      );
    }
  }
  if (flags.user !== undefined && flags.user.trim().length === 0) {
    throw new CliError("--user must be a nonempty user id.", EXIT_INVALID_ARGS);
  }
}

/**
 * The identity for one flow action, or a refusal naming the flow and `--org`.
 *
 * Refusals are `CliError`s with the invalid-arguments exit code, carrying the
 * resolver's own message. Nothing falls back to the development organization.
 */
export async function resolveCliPrincipal(
  ask: AskPrincipal,
  target: { flowKind: string; action: string; input: unknown },
  flags: PrincipalFlags,
): Promise<CliPrincipal> {
  validatePrincipalFlags(flags);
  const namedUser = flags.user ?? DEFAULT_CLI_USER;
  if (flags.org !== undefined) {
    return { userId: namedUser, orgId: flags.org, from: "flag" };
  }
  let answer: InProcessPrincipal;
  try {
    answer = await ask({ ...target, userId: namedUser });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `Flow "${target.flowKind}" refused this terminal: ${reason}\n` +
        `The CLI carries no credential, so a resolver that checks one refuses it. ` +
        `Pass --org <id> to name the organization yourself. Nothing was written.`,
      EXIT_INVALID_ARGS,
    );
  }
  return {
    userId: flags.user ?? answer.userId,
    orgId: answer.orgId,
    from: answer.from,
  };
}

/** One stderr line naming who a run is. */
export function describePrincipal(principal: CliPrincipal): string {
  const how =
    principal.from === "flag"
      ? "named by --org"
      : principal.from === "development-default"
        ? "no resolver configured"
        : "from the app's resolver";
  return `[fsdev] running as ${principal.userId} in organization ${principal.orgId} (${how})`;
}

/**
 * Refuse a session another organization or another user owns — read only, so
 * it can run before any seed or run writes (BR-11). Returns the refusal
 * message, or `undefined` when the session is absent or this identity's.
 */
export async function checkSessionOwner(
  stores: StoreRegistry,
  sessionId: string,
  principal: CliPrincipal,
): Promise<string | undefined> {
  const record = await stores.session.get(sessionId);
  if (record === undefined) return undefined;
  if (record.orgId === principal.orgId && record.userId === principal.userId) return undefined;
  return (
    `Session "${sessionId}" belongs to user ${record.userId} in organization ${record.orgId ?? "(none)"}; ` +
    `this run is ${principal.userId} in ${principal.orgId}. Nothing was written. ` +
    `A session keeps the user and organization it was created with; use a new session id.`
  );
}
