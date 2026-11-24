/**
 * The teammate forms: hire one, or edit one's name, instructions, model and
 * default coding harness. Each opens in a dialog over the page rather than in
 * it, so a half-filled form never pushes the conversation around. Esc, Cancel
 * or a save closes the dialog and puts focus back on the button that opened it.
 *
 * Editing also picks the teammate's look: one of the bot faces and one of the
 * team colors, saved as its `icon` and `color` settings.
 *
 * The model is what the teammate's own replies run on; the default coding
 * harness is where the composer's "Code with" starts. Both are the teammate's
 * settings, saved through the roster's `settingsPatch` so the settings the
 * page doesn't show (Lead's `delegates`, its capabilities) are left as they were.
 */
import { isSendKey, useSubmit } from "@flow-state-dev/react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { EditWorkerInput, HireWorkerInput } from "@flow-state-dev/workforce/browser";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AppContext } from "../../flows/lab-context.mts";
import { harnessName, harnessState, HARNESS_STATUS_WORDS } from "../lib/harness";
import { ownEscape, useFocusReturn } from "../lib/keys";
import { BOT_FACES, TEAMMATE_COLORS, type BotFace, type TeammateColor } from "../lib/looks";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";

/** A model as `TEAMMATES_MODELS` names it, without its provider or route: `openrouter:openai/gpt-6-sol` reads `gpt-6-sol`. */
export const shortModelName = (model: string) => model.slice(Math.max(model.lastIndexOf("/"), model.lastIndexOf(":")) + 1) || model;

/** What a teammate's settings fields choose from: the lab's models (with their routes) and its coding harnesses (with their readiness). */
export type SettingsChoices = {
  models?: AppContext["models"];
  harnesses?: readonly HarnessReadinessChipRow[];
};

/** A teammate's model, default coding harness and look (its bot's face, `icon`, and its `color`), as the form holds them. */
type Picked = { model?: string; harness?: string; icon?: BotFace; color?: TeammateColor };

/**
 * One dialog for a teammate form. Focus returns to the opener on close, and
 * Esc in it never counts toward the composer's Esc Esc stop.
 */
export function TeammateDialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  const focus = useFocusReturn(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border-strong bg-surface" onCloseAutoFocus={focus.onCloseAutoFocus} onEscapeKeyDown={ownEscape}>
        <DialogTitle className="text-base">{title}</DialogTitle>
        <DialogDescription className="text-sm text-text-2">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Shell({ label, error, children, onSubmit }: { label: string; error?: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <form aria-label={label} onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
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

const field = "rounded-sm border border-border-strong bg-card px-2 py-1.5";
const primary = "rounded-sm bg-brand px-3 py-1.5 font-semibold text-brand-foreground disabled:opacity-40";
const plain = "rounded-sm border border-border-strong px-3 py-1.5 hover:bg-accent";

/** A labelled field: the label above, a hint under it when there is one. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-2">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-xs text-text-3">{hint}</span>}
    </label>
  );
}

/**
 * The model and default coding harness fields. A model with no key or gateway
 * is listed but can't be picked, its reason beside it; a harness shows whether
 * it can run here. A current value the lab's list doesn't name is kept, first.
 */
function SettingsFields({ who, choices, picked, onChange }: { who: string; choices: SettingsChoices; picked: Picked; onChange: (next: Picked) => void }) {
  const models = choices.models ?? [];
  const harnesses = choices.harnesses ?? [];
  const extraModel = picked.model !== undefined && !models.some((m) => m.id === picked.model);
  const extraHarness = picked.harness !== undefined && !harnesses.some((h) => h.harness === picked.harness);
  return (
    <>
      {models.length === 0 && picked.model === undefined ? null : (
        <Field label="Model" hint={`What ${who}'s own replies run on, from its next reply.`}>
          <select aria-label={`Model for ${who}`} value={picked.model ?? ""} onChange={(e) => onChange({ ...picked, model: e.target.value })} className={field}>
            {extraModel ? <option value={picked.model}>{shortModelName(picked.model!)}</option> : null}
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {shortModelName(m.id)} · {m.available ? `via ${m.via}` : m.reason}
              </option>
            ))}
          </select>
        </Field>
      )}
      {harnesses.length === 0 && picked.harness === undefined ? null : (
        <Field label="Default coding harness" hint={`Where "Code with" starts in ${who}'s conversation. You can still pick another per message.`}>
          <select aria-label={`Default coding harness for ${who}`} value={picked.harness ?? ""} onChange={(e) => onChange({ ...picked, harness: e.target.value })} className={field}>
            {extraHarness ? <option value={picked.harness}>{harnessName(picked.harness!)}</option> : null}
            {harnesses.map((h) => (
              <option key={h.harness} value={h.harness}>
                {h.label} · {HARNESS_STATUS_WORDS[harnessState(h)]}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

/** One choice in a picker of the look: a square button that says whether it is picked. */
const CHOICE = "grid place-items-center rounded-md p-0.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The teammate's look: its bot's face, drawn in the color it has picked, and
 * its color. Each is a group of choices; the picked one is ringed.
 */
function LookFields({ who, face, color, onChange }: { who: string; face: BotFace; color: TeammateColor; onChange: (next: { icon?: BotFace; color?: TeammateColor }) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-text-2">Look</legend>
      <div role="radiogroup" aria-label={`Face for ${who}`} className="flex flex-wrap gap-1.5">
        {BOT_FACES.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={f === face} aria-label={f} title={f} onClick={() => onChange({ icon: f })} className={cn(CHOICE, f === face ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-border-strong")}>
            <Avatar look={{ face: f, color }} />
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={`Color for ${who}`} className="flex flex-wrap gap-1.5">
        {TEAMMATE_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} title={c} onClick={() => onChange({ color: c })} className={cn(CHOICE, c === color ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-border-strong")}>
            <span aria-hidden data-swatch={c} className="block size-5 rounded-[5px]" style={{ background: `var(--team-${c}-tile)` }} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The settings a form changed from where it started: only those are sent. */
const changed = (start: Picked, now: Picked): Record<string, string> =>
  Object.fromEntries((["model", "harness", "icon", "color"] as const).filter((k) => now[k] !== undefined && now[k] !== start[k]).map((k) => [k, now[k]!]));

/** Hire a teammate: its name, the one line Lead reads to know when to ask it, its instructions, model and default coding harness. */
export function HireForm({ onHire, onCancel, choices = {}, defaults = {} }: { onHire: (teammate: HireWorkerInput) => Promise<void>; onCancel: () => void; choices?: SettingsChoices; defaults?: Picked }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [picked, setPicked] = useState<Picked>(defaults);
  const { error, busy, submit } = useSubmit(() => {
    // Only a setting picked away from the lab's default is the teammate's own; left alone, it follows the lab's.
    const settings = changed(defaults, picked);
    return onHire({ id: name.trim().toLowerCase(), description: role.trim(), instructions, ...(Object.keys(settings).length === 0 ? {} : { settings }) });
  });
  return (
    <Shell label="Hire a teammate" error={error} onSubmit={(e) => void submit(e)}>
      <Field label="Name">
        <input aria-label="Teammate name" placeholder="e.g. tester" value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </Field>
      <Field label="Role">
        <input aria-label="Teammate role" placeholder="What it does, in one line" value={role} onChange={(e) => setRole(e.target.value)} className={field} />
      </Field>
      <Field label="Instructions">
        <textarea aria-label="Teammate instructions" placeholder="Its instructions" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} onKeyDown={sendOnShortcut} className={field} />
      </Field>
      <SettingsFields who="the new teammate" choices={choices} picked={picked} onChange={setPicked} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={plain}>
          Cancel
        </button>
        <button type="submit" disabled={busy || name.trim() === "" || role.trim() === ""} className={primary}>
          Hire
        </button>
      </div>
    </Shell>
  );
}

/**
 * Rename a teammate, replace its instructions, change its model or default
 * coding harness. A blank name clears it, so the list shows its id. Its next
 * turn reads them; a turn already running keeps the ones it started with. The
 * page can't read the old instructions back, since they stay on the server, so
 * a blank box keeps them and a filled one replaces them whole.
 */
export function EditForm({
  name,
  onSave,
  onCancel,
  choices = {},
  current = {},
  children,
}: {
  name: string;
  onSave: (edit: Omit<EditWorkerInput, "id">) => Promise<void>;
  onCancel: () => void;
  choices?: SettingsChoices;
  /** The teammate's model and default harness now (its own setting, else the lab's), and its look. */
  current?: Picked;
  /** More under the buttons: the reset, for an edited teammate. */
  children?: ReactNode;
}) {
  const [newName, setNewName] = useState(name);
  const [instructions, setInstructions] = useState("");
  const [picked, setPicked] = useState<Picked>(current);
  const renamed = newName.trim() !== name;
  const settingsPatch = changed(current, picked);
  const settingsChanged = Object.keys(settingsPatch).length > 0;
  const { error, busy, submit } = useSubmit(() =>
    onSave({
      ...(renamed ? { name: newName.trim() === "" ? null : newName.trim() } : {}),
      ...(instructions.trim() === "" ? {} : { instructions }),
      ...(settingsChanged ? { settingsPatch } : {}),
    }),
  );
  return (
    <Shell label={`Edit ${name}`} error={error} onSubmit={(e) => void submit(e)}>
      <Field label="Name">
        <input aria-label={`Name of ${name}`} value={newName} onChange={(e) => setNewName(e.target.value)} className={field} />
      </Field>
      <Field label="Instructions" hint="They replace the old ones from its next turn. Leave blank to keep them.">
        <textarea
          aria-label={`New instructions for ${name}`}
          placeholder={`${name}'s new instructions, in full.`}
          rows={4}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onKeyDown={sendOnShortcut}
          className={field}
        />
      </Field>
      {picked.icon === undefined || picked.color === undefined ? null : (
        <LookFields who={name} face={picked.icon} color={picked.color} onChange={(look) => setPicked({ ...picked, ...look })} />
      )}
      <SettingsFields who={name} choices={choices} picked={picked} onChange={setPicked} />
      <div className="flex items-center justify-end gap-2">
        {children === undefined ? null : <div className="mr-auto">{children}</div>}
        <button type="button" onClick={onCancel} className={plain}>
          Cancel
        </button>
        <button type="submit" disabled={busy || (!renamed && instructions.trim() === "" && !settingsChanged)} className={primary}>
          Save
        </button>
      </div>
    </Shell>
  );
}
