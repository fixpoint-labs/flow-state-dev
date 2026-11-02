import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ownEscape, useFocusReturn } from "../lib/keys";

/** `?`: the lab's keys. */
export function KeysSheet({ open, onOpenChange, keys }: { open: boolean; onOpenChange: (open: boolean) => void; keys: ReadonlyArray<readonly [string, string]> }) {
  const focus = useFocusReturn(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-none" onCloseAutoFocus={focus.onCloseAutoFocus} onEscapeKeyDown={ownEscape}>
        <DialogTitle className="text-sm">Keys</DialogTitle>
        <DialogDescription className="sr-only">Every key this app has.</DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {keys.map(([key, what]) => (
            <div key={key} className="contents" data-key-row>
              <dt className="font-mono text-xs">{key}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
