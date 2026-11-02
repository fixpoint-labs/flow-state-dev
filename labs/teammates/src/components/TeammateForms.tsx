import { isSendKey, useSubmit } from "@flow-state-dev/react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { NewTeammate } from "../adapter";

function Shell({ label, error, children, onSubmit }: { label: string; error?: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <form aria-label={label} onSubmit={onSubmit} className="flex flex-col gap-2 text-xs">
      {children}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Cmd+Enter (Ctrl+Enter) in a form's text box presses its submit button, so a
 * form that can't send yet (the button disabled) sends nothing. Plain Enter
 * stays a new line.
 */
function sendOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (!isSendKey(event)) return;
  event.preventDefault();
  const button = event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button && !button.disabled) button.click();
}

const field = "rounded-sm border border-border bg-card px-2 py-1";
const primary = "rounded-sm bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-40";
const plain = "rounded-sm border border-border px-2 py-1 hover:bg-accent";

/** Hire a teammate: its name, the one line Chief of Staff reads to know when to ask it, and its instructions. */
export function HireForm({ onHire, onCancel }: { onHire: (teammate: NewTeammate) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const { error, busy, submit } = useSubmit(() => onHire({ name: name.trim().toLowerCase(), role: role.trim(), instructions }));
  return (
    <Shell label="Hire a teammate" error={error} onSubmit={(e) => void submit(e)}>
      <input aria-label="Teammate name" placeholder="name, e.g. tester" value={name} onChange={(e) => setName(e.target.value)} className={field} />
      <input aria-label="Teammate role" placeholder="What it does, in one line" value={role} onChange={(e) => setRole(e.target.value)} className={field} />
      <textarea aria-label="Teammate instructions" placeholder="Its instructions" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} onKeyDown={sendOnShortcut} className={field} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || name.trim() === "" || role.trim() === ""} className={primary}>
          Hire
        </button>
        <button type="button" onClick={onCancel} className={plain}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

/**
 * Replace a teammate's instructions. Its next turn reads them; a turn already
 * running keeps the ones it started with. The page can't read the old ones
 * back, since instructions stay on the server, so this sets them whole.
 */
export function InstructionsForm({ name, onSave, onCancel }: { name: string; onSave: (instructions: string) => Promise<void>; onCancel: () => void }) {
  const [instructions, setInstructions] = useState("");
  const { error, busy, submit } = useSubmit(() => onSave(instructions));
  return (
    <Shell label={`Instructions for ${name}`} error={error} onSubmit={(e) => void submit(e)}>
      <textarea
        aria-label={`New instructions for ${name}`}
        placeholder={`${name}'s new instructions, in full. They replace the old ones from its next turn.`}
        rows={4}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        onKeyDown={sendOnShortcut}
        className={field}
      />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || instructions.trim() === ""} className={primary}>
          Save instructions
        </button>
        <button type="button" onClick={onCancel} className={plain}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}
