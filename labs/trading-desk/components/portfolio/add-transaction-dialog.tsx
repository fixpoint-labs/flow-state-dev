/**
 * AddTransactionDialog — compact native `<dialog>` for recording one manual
 * ledger event (FIX-774): account, type, trade date, ticker, quantity, unit
 * price, amount, an optional description, and a "basis unknown" reason that
 * surfaces only for a transfer.
 *
 * Mirrors `AddAccountDialog`'s native-`<dialog>` idiom (imperative open/close
 * from `open`, `td-sheet` bottom-sheet class, the shared field styling). It
 * calls the parent's `onSubmit` with the action input (sans `source`/
 * `externalId` — the handler fixes `source: "manual"`); the parent owns the
 * `recordLedgerEvent` dispatch and the ledger refetch. Stateless about
 * persistence.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { AccountState } from "@/domain/portfolio/schema/portfolio-schema";
import type {
  LedgerEventType,
  SplitAttributes,
} from "@/domain/portfolio/schema/ledger-schema";

/** The action input the parent dispatches — the canonical event WITHOUT
 *  `source`/`externalId` (the handler fixes `source: "manual"`). */
type NewLedgerEvent = {
  accountId: string;
  type: LedgerEventType;
  tradeDate: string;
  amount: number;
  ticker: string | null;
  quantity: number | null;
  unitPrice: number | null;
  description: string | null;
  basisUnknown: string | null;
  /** Split ratio (FIX-876) — set ONLY for a `split`, null otherwise. */
  attributes: SplitAttributes | null;
};

type AddTransactionDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountState[];
  defaultAccountId: string | undefined;
  /** Persist the event. Parent dispatches `recordLedgerEvent` + refetches. */
  /** Persist the event. May REJECT (e.g. the one-source seam 409, FIX-895) — the
   *  dialog awaits it, renders a rejection as a visible error, and stays open. */
  onSubmit: (event: NewLedgerEvent) => Promise<void>;
};

const TYPE_OPTIONS: ReadonlyArray<{ value: LedgerEventType; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "interest", label: "Interest" },
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "transfer", label: "Transfer" },
  { value: "fee", label: "Fee" },
  { value: "split", label: "Split" },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

const labelTextClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";

/** Today as a LOCAL `YYYY-MM-DD` for the trade-date default. `toISOString()`
 *  would give the UTC calendar day, which near a timezone boundary pre-fills
 *  yesterday/tomorrow relative to the user's local date. */
function today(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Apply the canonical sign convention by type so the user enters a magnitude:
 *  a buy adds shares (+), a sell removes them (−). `deriveLots` keys off the
 *  quantity SIGN, so a `sell` entered as a positive number must not land as an
 *  acquisition. A transfer keeps the entered sign (it can be in or out); cash
 *  events carry no quantity. */
function signedQuantity(type: LedgerEventType, quantity: number | null): number | null {
  if (quantity === null) return null;
  if (type === "buy") return Math.abs(quantity);
  if (type === "sell") return -Math.abs(quantity);
  return quantity;
}

/** Parse an optional numeric field. Blank → null; otherwise a number (NaN if
 *  unparseable, caught by the submit validation). */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return Number(trimmed.replace(/[$,\s]/g, ""));
}

export function AddTransactionDialog({
  open,
  onClose,
  accounts,
  defaultAccountId,
  onSubmit,
}: AddTransactionDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState<LedgerEventType>("buy");
  const [tradeDate, setTradeDate] = useState(today());
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [basisUnknown, setBasisUnknown] = useState("");
  // Split ratio inputs (FIX-876), used only when type === "split".
  const [numerator, setNumerator] = useState("");
  const [denominator, setDenominator] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  // Drive the native <dialog> imperatively from `open` (matches AddAccountDialog).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset the draft on each open so a prior cancel doesn't leak stale text.
  useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId ?? accounts[0]?.accountId ?? "");
      setType("buy");
      setTradeDate(today());
      setTicker("");
      setQuantity("");
      setUnitPrice("");
      setAmount("");
      setDescription("");
      setBasisUnknown("");
      setNumerator("");
      setDenominator("");
      setError(undefined);
    }
  }, [open, defaultAccountId, accounts]);

  const handleSubmit = async (): Promise<void> => {
    if (accountId.length === 0) {
      setError("Account is required");
      return;
    }
    if (tradeDate.trim().length === 0) {
      setError("Trade date is required");
      return;
    }
    // A split (FIX-876) carries no cash/quantity — just a ticker and a
    // numerator:denominator ratio. Validate + emit it on its own path (the same
    // shape the server's `refineLedgerEvent` enforces: attributes present,
    // quantity null, amount 0).
    if (type === "split") {
      const splitTicker = ticker.trim().toUpperCase();
      if (splitTicker.length === 0) {
        setError("Ticker is required for a split");
        return;
      }
      const num = Number(numerator.trim());
      const den = Number(denominator.trim());
      if (!Number.isInteger(num) || num <= 0 || !Number.isInteger(den) || den <= 0) {
        setError("Split ratio must be positive whole numbers (e.g. 10 for 1)");
        return;
      }
      const trimmedNote = description.trim();
      onSubmit({
        accountId,
        type: "split",
        tradeDate: tradeDate.trim(),
        amount: 0,
        ticker: splitTicker,
        quantity: null,
        unitPrice: null,
        description: trimmedNote.length === 0 ? null : trimmedNote,
        basisUnknown: null,
        attributes: { numerator: num, denominator: den },
      });
      onClose();
      return;
    }
    const amountNum = Number(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amountNum)) {
      setError("Amount must be a number (negative = cash out)");
      return;
    }
    const quantityNum = parseOptionalNumber(quantity);
    if (quantityNum !== null && !Number.isFinite(quantityNum)) {
      setError("Quantity must be a number");
      return;
    }
    const unitPriceNum = parseOptionalNumber(unitPrice);
    if (unitPriceNum !== null && !Number.isFinite(unitPriceNum)) {
      setError("Unit price must be a number");
      return;
    }
    const trimmedTicker = ticker.trim().toUpperCase();
    // A buy/sell with no security is a share move `deriveLots` can't apply — it
    // would land in the ledger but never update derived basis. Require both.
    if (type === "buy" || type === "sell") {
      if (trimmedTicker.length === 0) {
        setError("Ticker is required for a buy or sell");
        return;
      }
      if (quantityNum === null) {
        setError("Quantity is required for a buy or sell");
        return;
      }
    }
    const trimmedDescription = description.trim();
    const trimmedBasis = basisUnknown.trim();
    // Await the persist so a server rejection (the one-source seam 409, FIX-895)
    // renders as a visible error and the dialog stays open — never a silent close.
    try {
      await onSubmit({
        accountId,
        type,
        tradeDate: tradeDate.trim(),
        amount: amountNum,
        ticker: trimmedTicker.length === 0 ? null : trimmedTicker,
        quantity: signedQuantity(type, quantityNum),
        unitPrice: unitPriceNum,
        description: trimmedDescription.length === 0 ? null : trimmedDescription,
        basisUnknown:
          type === "transfer" && trimmedBasis.length > 0 ? trimmedBasis : null,
        attributes: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the transaction.");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "td-sheet m-auto rounded border p-0 backdrop:bg-black/40",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[color:var(--c-fg)]",
        "w-[min(440px,calc(100vw-32px))]",
      )}
    >
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Add transaction</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close add transaction"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.currentTarget.value)}
              className={inputClass}
            >
              {accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Type</span>
              <select
                value={type}
                onChange={(e) =>
                  setType(e.currentTarget.value as LedgerEventType)
                }
                className={inputClass}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Trade date</span>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.currentTarget.value)}
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Ticker</span>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.currentTarget.value.toUpperCase())}
                className={inputClass}
                placeholder="NVDA"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            {/* A split has no share quantity — it rebases existing lots by a
                ratio (below), so hide Quantity for it. */}
            {type !== "split" ? (
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Quantity</span>
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.currentTarget.value)}
                  className={inputClass}
                  placeholder="10"
                  inputMode="decimal"
                />
              </label>
            ) : null}
          </div>

          {/* A split carries no price/amount; it takes a numerator:denominator
              ratio instead (10-for-1 → 10 and 1; reverse 1-for-10 → 1 and 10). */}
          {type === "split" ? (
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>New shares (numerator)</span>
                <input
                  value={numerator}
                  onChange={(e) => setNumerator(e.currentTarget.value)}
                  className={inputClass}
                  placeholder="10"
                  inputMode="numeric"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Per (denominator)</span>
                <input
                  value={denominator}
                  onChange={(e) => setDenominator(e.currentTarget.value)}
                  className={inputClass}
                  placeholder="1"
                  inputMode="numeric"
                />
              </label>
            </div>
          ) : (
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Unit price</span>
                <input
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.currentTarget.value)}
                  className={inputClass}
                  placeholder="120"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.currentTarget.value)}
                  className={inputClass}
                  placeholder="-1200"
                  inputMode="decimal"
                />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              className={inputClass}
              placeholder="Optional note"
              autoComplete="off"
            />
          </label>

          {/* A transfer-in with no acquisition record is a basis hole — capture
              the reason so the derived lot is flagged, never zero-filled. */}
          {type === "transfer" ? (
            <label className="flex flex-col gap-1">
              <span className={labelTextClass}>Basis unknown (reason)</span>
              <input
                value={basisUnknown}
                onChange={(e) => setBasisUnknown(e.currentTarget.value)}
                className={inputClass}
                placeholder="Transfer-in, no acquisition record"
                autoComplete="off"
              />
            </label>
          ) : null}

          {error !== undefined ? (
            <p className="text-[10.5px] text-[color:var(--c-warn)]">⚠ {error}</p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--c-border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[color:var(--c-border)] px-3 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            className="rounded bg-[color:var(--c-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Add transaction
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export type { NewLedgerEvent };
