/**
 * Benchmark cost pricing.
 *
 * The estimator and its price table now live at the eval layer (`../eval/cost`)
 * so the LLM-judge scorer can price its own calls without an import cycle. This
 * module re-exports `estimateCostUsd` for the benchmark public surface.
 */
export { estimateCostUsd } from "../eval/cost";
