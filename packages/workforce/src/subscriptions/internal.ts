// FIX-2535.
/**
 * The subscription names workforce's `/internal` subpath carries: what other
 * FSD packages, goals and scripts share with workforce (a GitHub poll builds
 * on these), not an adopter's surface. Service-flow names are in
 * `../service-flows/internal`.
 */
// FIX-2536: polling's mechanics, for goals.
export { SUBSCRIPTION_POLLS_PATTERN } from "./keys";
