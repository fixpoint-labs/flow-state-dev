/**
 * Test fixture: a flow module that throws at import time, simulating
 * a flow with a top-level import problem (e.g. a prompt file that
 * fails to load). Discovery must report this instead of swallowing it.
 */
throw new Error("boom on import");
