/**
 * A worker's standing rules for the user (FIX-1945 S6): the notes the user
 * asked that worker to keep, read and edited through the worker's own rules
 * action (`createWorkforceClient().standingRules`).
 *
 * The page holds no rule of its own. Every edit names the version of the list
 * it was drawn from, and the Lab checks it with the same limits the worker's
 * tools obey: a refused edit comes back with the Lab's reason and the list is
 * read again, so the page never shows a list the Lab doesn't hold.
 */
import { useCallback, useEffect, useState } from "react";
import type { StandingRulesActionOutput } from "@flow-state-dev/workforce/browser";
import { describeFailure, type Failure } from "./reads";
import { useWorkforce } from "./workforce";

/** One rule as the page draws it. */
export type StandingRule = StandingRulesActionOutput["rules"][number];

/** The list read: the list, why it couldn't be read, or `undefined` until the first read lands. */
export type RulesRead = { list: StandingRulesActionOutput } | { failure: Failure } | undefined;

/** One edit the page makes. Change and remove name the rule as it was drawn. */
export type RuleEditInput =
  | { op: "add"; text: string }
  | { op: "change"; rule: StandingRule; text: string }
  | { op: "remove"; rule: StandingRule };

export interface StandingRulesView {
  read: RulesRead;
  /** Whether an edit is on its way. */
  busy: boolean;
  /** Why the last edit was refused; cleared by the next edit. */
  refused: Failure | undefined;
  /** Read the list again. */
  reread(): void;
  /** Make one edit, as the list drawn now. Resolves `true` when it landed. */
  edit(input: RuleEditInput): Promise<boolean>;
}

/** `worker`'s standing rules for the user, and the edits the page makes to them. */
export function useStandingRules(workerId: string): StandingRulesView {
  const workforce = useWorkforce();
  const [read, setRead] = useState<RulesRead>(undefined);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let closed = false;
    workforce
      .standingRules(workerId, { op: "read" })
      .then((list) => {
        if (!closed) setRead({ list });
      })
      .catch((error: unknown) => {
        if (!closed) setRead({ failure: describeFailure(error) });
      });
    return () => {
      closed = true;
    };
  }, [workforce, workerId, reads]);

  const reread = useCallback(() => setReads((n) => n + 1), []);

  const edit = useCallback(
    async (input: RuleEditInput): Promise<boolean> => {
      if (read === undefined || "failure" in read) return false;
      const version = read.list.version;
      setBusy(true);
      setRefused(undefined);
      try {
        const list = await workforce.standingRules(
          workerId,
          input.op === "add"
            ? { op: "add", version, text: input.text }
            : input.op === "change"
              ? { op: "change", version, number: input.rule.number, current: input.rule.text, text: input.text }
              : { op: "remove", version, number: input.rule.number, current: input.rule.text },
        );
        setRead({ list });
        return true;
      } catch (error) {
        setRefused(describeFailure(error));
        // A refusal may mean the list moved under the page: draw the one the Lab holds.
        reread();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workforce, workerId, read, reread],
  );

  return { read, busy, refused, reread, edit };
}
