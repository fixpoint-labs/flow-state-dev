/**
 * Kits: the installable unit above a flow, and the slots kits fill in each
 * other. See `define-kit.ts`; the engine installs them (`createFlowState({ kits })`).
 */
export {
  defineKit,
  slot,
  type AnyKitFactory,
  type KeyedSlot,
  type KitDefinition,
  type KitFactory,
  type KitFolder,
  type KitInstallation,
  type KitInstallInput,
  type KitInstance,
  type KitWithheld,
  type ListSlot,
  type SlotDeclaration,
  type SlotKey,
  type SlotValue,
} from "./define-kit";
