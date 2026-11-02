/**
 * A worker's standing rules for the user (FIX-1945 S6): each rule with when
 * it was added and the conversation it came from, and add, edit and delete.
 * Drawn as the Rules section of a roster worker's settings page.
 *
 * Every edit goes to the Lab, which checks it with the limits the worker's
 * own tools obey; what is drawn is the list the Lab answered with. A refused
 * edit shows the Lab's reason, and the list is read again.
 */
import { useState } from "react";
import { traceHref } from "@flow-state-dev/devtool/react";
import { MAX_RULE_CHARS, MAX_RULES } from "@flow-state-dev/workforce/browser";
import { useStandingRules, type StandingRule, type StandingRulesView } from "../lib/rules";
import { SectionFailure } from "./ui";

/**
 * @param workerId The worker whose rules these are.
 * @param name What the page calls the worker.
 * @param devtoolUrl The DevTool a rule's conversation opens in, when one is served.
 */
export function StandingRules({ workerId, name, devtoolUrl }: { workerId: string; name: string; devtoolUrl?: string }) {
  const rules = useStandingRules(workerId);
  const { read } = rules;
  const list = read !== undefined && "list" in read ? read.list : undefined;
  const full = list !== undefined && list.rules.length >= MAX_RULES;

  return (
    <section className="max-w-2xl space-y-3" data-testid="rules" data-worker-id={workerId} data-version={list?.version ?? ""}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.1em]">RULES</h2>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="rules-count">
          {list === undefined ? "" : `${list.rules.length} of ${MAX_RULES}`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="rules-limits">
        Notes {name} keeps for you and follows on every turn. Up to {MAX_RULES}, each one line of up to {MAX_RULE_CHARS} characters. A change counts from
        the next turn.
      </p>
      {read === undefined ? (
        <p className="text-sm text-muted-foreground" data-testid="rules-reading">
          Reading the rules…
        </p>
      ) : "failure" in read ? (
        <SectionFailure what="The rules" failure={read.failure} onRetry={rules.reread} testId="rules-failure" />
      ) : (
        <>
          {read.list.rules.length === 0 ? (
            <p className="border border-dashed px-3 py-2.5 text-sm text-muted-foreground" data-testid="rules-empty">
              {name} keeps no rules for you yet. Tell it how you want it to work, or add one here.
            </p>
          ) : (
            <ol className="divide-y border" data-testid="rules-list">
              {read.list.rules.map((rule) => (
                <RuleRow key={`${rule.number}:${rule.text}`} rule={rule} devtoolUrl={devtoolUrl} busy={rules.busy} edit={rules.edit} />
              ))}
            </ol>
          )}
          <AddRule full={full} busy={rules.busy} add={(text) => rules.edit({ op: "add", text })} />
        </>
      )}
      {rules.refused === undefined ? null : (
        <p className="text-xs text-destructive" role="alert" data-testid="rules-refused">
          Not saved: {rules.refused.message}
        </p>
      )}
    </section>
  );
}

/** Where a rule came from: a link to its conversation, or *added here*. */
function Origin({ rule, devtoolUrl }: { rule: StandingRule; devtoolUrl?: string }) {
  if (rule.sessionId === null) return <span data-testid="rule-origin" data-origin="here">added here</span>;
  if (devtoolUrl === undefined) {
    return (
      <span title={rule.sessionId} data-testid="rule-origin" data-origin="conversation" data-session-id={rule.sessionId}>
        from a conversation
      </span>
    );
  }
  return (
    <a href={traceHref(devtoolUrl, rule.sessionId)} target="_blank" rel="noreferrer" className="underline" data-testid="rule-origin" data-origin="conversation" data-session-id={rule.sessionId}>
      from a conversation
    </a>
  );
}

function RuleRow({ rule, devtoolUrl, busy, edit }: { rule: StandingRule; devtoolUrl?: string; busy: boolean; edit: StandingRulesView["edit"] }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-1 px-3 py-2" data-testid="rule" data-number={rule.number}>
      {draft === null ? (
        <div className="flex items-start gap-2">
          <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{rule.number}.</span>
          <span className="min-w-0 flex-1 break-words text-sm" data-testid="rule-text">
            {rule.text}
          </span>
          <button type="button" disabled={busy} onClick={() => setDraft(rule.text)} className="border px-2 py-0.5 text-xs disabled:opacity-50" data-testid="rule-edit">
            Edit
          </button>
          <button type="button" disabled={busy} onClick={() => void edit({ op: "remove", rule })} className="border px-2 py-0.5 text-xs disabled:opacity-50" data-testid="rule-delete">
            Delete
          </button>
        </div>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void edit({ op: "change", rule, text: draft }).then((landed) => {
              if (landed) setDraft(null);
            });
          }}
        >
          <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{rule.number}.</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Rule ${rule.number}`}
            className="min-w-0 flex-1 border bg-background px-2 py-1 text-sm"
            data-testid="rule-input"
          />
          <button type="submit" disabled={busy || draft.trim() === ""} className="border px-2 py-0.5 text-xs disabled:opacity-50" data-testid="rule-save">
            Save
          </button>
          <button type="button" onClick={() => setDraft(null)} className="border px-2 py-0.5 text-xs" data-testid="rule-cancel">
            Cancel
          </button>
        </form>
      )}
      <p className="pl-7 font-mono text-[11px] text-muted-foreground" data-testid="rule-meta">
        added {new Date(rule.addedAt).toLocaleString()} · <Origin rule={rule} devtoolUrl={devtoolUrl} />
      </p>
    </li>
  );
}

function AddRule({ full, busy, add }: { full: boolean; busy: boolean; add: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  if (full) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="rules-full">
        The list is full ({MAX_RULES} of {MAX_RULES}). Edit or delete a rule to add another.
      </p>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add(draft).then((landed) => {
          if (landed) setDraft("");
        });
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="A new rule, one line"
        aria-label="New rule"
        className="min-w-0 flex-1 border bg-background px-2 py-1 text-sm"
        data-testid="rule-add-input"
      />
      <span className={`font-mono text-[11px] ${draft.length > MAX_RULE_CHARS ? "text-destructive" : "text-muted-foreground"}`} data-testid="rule-add-chars">
        {draft.length}/{MAX_RULE_CHARS}
      </span>
      <button type="submit" disabled={busy || draft.trim() === ""} className="border px-3 py-1 text-sm disabled:opacity-50" data-testid="rule-add">
        Add
      </button>
    </form>
  );
}
