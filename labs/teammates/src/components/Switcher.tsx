import type { WorkerRow } from "../adapter";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useFocusReturn } from "../lib/keys";

/** A result matches when its value or a keyword holds the query, ignoring case; no fuzzy match, so "hire" finds Hire and no one else. */
const contains = (value: string, search: string, keywords: string[] = []) =>
  [value, ...keywords].some((word) => word.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0;

/**
 * ⌘K: every teammate, found by its name, its role or its id, and *Hire a
 * teammate*. Focus goes back where it was when it closes without a pick.
 */
export function Switcher({
  open,
  onOpenChange,
  teammates,
  onPick,
  onHire,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teammates: WorkerRow[];
  onPick: (worker: string) => void;
  onHire: () => void;
}) {
  const focus = useFocusReturn(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={focus.onCloseAutoFocus} className="top-24 translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Switch to a teammate</DialogTitle>
        <DialogDescription className="sr-only">Find a teammate by name or role, or hire one.</DialogDescription>
        <Command label="Switch to a teammate" filter={contains}>
          <CommandInput placeholder="A teammate…" />
          <CommandList>
            <CommandEmpty>No teammate matches.</CommandEmpty>
            <CommandGroup heading="Teammates">
              {teammates.map((w) => (
                <CommandItem
                  key={w.id}
                  value={w.id}
                  keywords={[w.name, w.role]}
                  onSelect={() => {
                    focus.picked();
                    onPick(w.id);
                  }}
                >
                  <span className="truncate">{w.name}</span>
                  {w.role ? <span className="ml-auto truncate text-xs text-muted-foreground">{w.role}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem
                value="Hire a teammate"
                onSelect={() => {
                  focus.picked();
                  onHire();
                }}
              >
                Hire a teammate
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
