import type { SessionRow } from "../adapter";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFocusReturn } from "../lib/keys";
import { MODES, modeOfWorker, type ModeId } from "../modes";

/** A result matches when its value or a keyword holds the query, ignoring case; no fuzzy match, so "new" finds New session and nothing it only resembles. */
const contains = (value: string, search: string, keywords: string[] = []) =>
  [value, ...keywords].some((word) => word.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0;

/**
 * ⌘K: every session in every view, grouped by view, found by its title or
 * its id, plus *New session* in each view. Picking one switches to its view.
 * Focus goes back where it was when it closes without a pick.
 */
export function Switcher({
  open,
  onOpenChange,
  sessions,
  modes,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionRow[];
  /** The modes the adapter serves; a view it doesn't serve is left out. */
  modes: readonly ModeId[];
  /** `id` undefined is *New session* in that view. */
  onPick: (view: ModeId, id: string | undefined) => void;
}) {
  const views = MODES.filter(
    (mode) => mode.available && modes.includes(mode.id),
  );
  const focus = useFocusReturn(open);
  const choose = (view: ModeId, id: string | undefined) => {
    focus.picked();
    onPick(view, id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className="top-24 translate-y-0 gap-0 overflow-hidden rounded-none p-0"
      >
        <DialogTitle className="sr-only">Switch session</DialogTitle>
        <DialogDescription className="sr-only">
          Find a session by its title, or start a new one.
        </DialogDescription>
        <Command label="Switch session" filter={contains}>
          <CommandInput placeholder="A session…" />
          <CommandList>
            <CommandEmpty>No session matches.</CommandEmpty>
            {views.map((mode) => (
              <CommandGroup key={mode.id} heading={mode.view}>
                {sessions
                  .filter((s) => modeOfWorker(s.worker)?.id === mode.id)
                  .map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`${mode.id}:${s.id}`}
                      keywords={[s.title, s.id]}
                      onSelect={() => choose(mode.id, s.id)}
                    >
                      <span className="truncate">{s.title}</span>
                      {s.running ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          running
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                <CommandItem
                  value={`${mode.id}:new`}
                  keywords={["New session", mode.view]}
                  onSelect={() => choose(mode.id, undefined)}
                >
                  + New session
                </CommandItem>
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
