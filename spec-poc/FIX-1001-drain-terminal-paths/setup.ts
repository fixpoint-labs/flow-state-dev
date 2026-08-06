/**
 * THROWAWAY setup for the FIX-1001 spec POC.
 *
 * The dev environment exports `FSDEV_DEFAULT_MODEL`, and `createModelResolver`
 * throws when that override is set but the flow declares no model intents —
 * which is the case for these POC flows (they are handlers and sequencers, no
 * generators). Clearing it keeps the POC on the real `runAction` path without
 * having to attach a mock model resolver that nothing here would use.
 */
delete process.env.FSDEV_DEFAULT_MODEL;
