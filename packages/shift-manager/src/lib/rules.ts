/** A worker's standing rules, read and edited through its rules action. */
import { useCallback, useEffect, useState } from "react";
import { STANDING_RULES_FLOWS, type StandingRulesActionOutput } from "@flow-state-dev/workforce/browser";
import { describeFailure, type Failure, type Worker } from "./reads";
import { useWorkforce } from "./workforce";

/** A flow Workforce says keeps rules (BR-20, BR-21a). */
export function keepsRules(worker: Pick<Worker, "kind">): boolean {
  return worker.kind !== null && STANDING_RULES_FLOWS.includes(worker.kind);
}

export type StandingRule = StandingRulesActionOutput["rules"][number];

type RulesRead = { list: StandingRulesActionOutput } | { failure: Failure } | undefined;

type RuleEditInput =
  | { op: "add"; text: string }
  | { op: "change"; rule: StandingRule; text: string }
  | { op: "remove"; rule: StandingRule };

export function useStandingRules(workerId: string) {
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
