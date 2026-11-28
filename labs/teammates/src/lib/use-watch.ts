/** The screen's clocks and feed-staleness, kept in `./now` so a card the app's renderers draw imports them without a cycle. */
export { age, useNow, useStale } from "./now";
