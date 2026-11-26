// "Lenses" = the questions a level designer asks. Each one is a filter preset plus the words
// that explain what the resulting view shows.
import type { Filters } from "../components/Sidebar";
import type { HeatmapKind } from "./types";
import { clock } from "./format";
import { pct, type ViewStats } from "./insights";

export type LensId = "traffic" | "fights" | "deaths" | "storm" | "loot" | "replay";

const NONE = { kill: false, death: false, storm: false, loot: false };

export interface Lens {
  id: LensId;
  chip: string; // short label for the question bar
  question: string;
  patch: Partial<Filters>; // filters applied when picked (replay also picks a match)
  /** what the view shows, in one sentence */
  seeing: (n: { matches: number; dateText: string }) => string;
  /** headline numbers for the current view */
  facts: (s: ViewStats) => string[];
  hotspotNoun: string; // "of all movement", "of all deaths"…
  next: string; // a suggested next step
}

const heat = (h: HeatmapKind, extra: Partial<Filters> = {}): Partial<Filters> => ({
  matchId: "all",
  heatmap: h,
  paths: false,
  cats: NONE,
  ...extra,
});

export const LENSES: Lens[] = [
  {
    id: "traffic",
    chip: "Where do players go?",
    question: "Where do players go?",
    patch: heat("traffic", { humans: true, bots: false }),
    seeing: ({ matches, dateText }) =>
      `Where human players spent their time across ${matches} matches (${dateText}). Every player's position is sampled every 5 seconds; brighter means more time spent there.`,
    facts: (s) => [`${s.humanRuns.toLocaleString()} player runs in view.`],
    hotspotNoun: "of all player movement",
    next: "Drag the timeline back to ~2:00 to see where players go first, then forward to see where they end up.",
  },
  {
    id: "fights",
    chip: "Where do fights happen?",
    question: "Where do fights happen?",
    patch: heat("kill", { humans: true, bots: true }),
    seeing: ({ matches, dateText }) =>
      `Every kill across ${matches} matches (${dateText}), placed where the killer was standing. Brighter means more kills.`,
    facts: (s) => {
      const total = s.botKillsByHumans + s.pvpKills;
      return total
        ? [
            `Players killed ${s.botKillsByHumans.toLocaleString()} bots and only ${s.pvpKills} other players. Combat here is almost entirely player-vs-bot.`,
          ]
        : ["No kills in this view."];
    },
    hotspotNoun: "of all kills",
    next: "Compare with “Where do players die?”. Areas where players get kills but rarely die are safe; the opposite are traps.",
  },
  {
    id: "deaths",
    chip: "Where do players die?",
    question: "Where do players die?",
    patch: heat("death", { humans: true, bots: false }),
    seeing: ({ matches, dateText }) =>
      `Every place a human player died across ${matches} matches (${dateText}). Brighter means more deaths.`,
    facts: (s) => {
      const d = s.humanDeaths;
      if (!d) return ["No player deaths in this view."];
      return [
        `${d} player deaths in ${s.humanRuns} runs (${pct(d / Math.max(1, s.humanRuns))} of runs end in death).`,
        `Cause: bots ${pct(s.diedToBot / d)} · storm ${pct(s.diedToStorm / d)} · other players ${pct(s.diedToPlayer / d)}.`,
      ];
    },
    hotspotNoun: "of all player deaths",
    next: "Click a hotspot to zoom in, then turn on Deaths markers and click one to open the match where it happened.",
  },
  {
    id: "storm",
    chip: "Where does the storm catch people?",
    question: "Where does the storm catch people?",
    patch: { matchId: "all", heatmap: "off", paths: false, humans: true, bots: false, cats: { ...NONE, storm: true } },
    seeing: ({ matches, dateText }) =>
      `Each ▲ is a player who died to the shrinking storm across ${matches} matches (${dateText}). Hover one to see when it happened.`,
    facts: (s) =>
      s.diedToStorm
        ? [
            `${s.diedToStorm} storm deaths in ${s.humanRuns} runs (${pct(s.diedToStorm / Math.max(1, s.humanRuns))} of runs).`,
            `They happen late: the first at ${clock(s.stormFirstT!)}, typically around ${clock(s.stormMedianT!)} into the match.`,
          ]
        : ["No storm deaths in this view."],
    hotspotNoun: "of storm deaths",
    next: "Switch maps and compare: if storm deaths are spread out rather than clustered, players are leaving too late, not taking a bad route.",
  },
  {
    id: "loot",
    chip: "Where is the loot?",
    question: "Where is the loot?",
    patch: heat("loot", { humans: true, bots: false }),
    seeing: ({ matches, dateText }) =>
      `Where players picked up items across ${matches} matches (${dateText}). Brighter means more pickups.`,
    facts: (s) => [
      `${s.humanLoot.toLocaleString()} pickups, about ${(s.humanLoot / Math.max(1, s.humanRuns)).toFixed(1)} per run.`,
    ],
    hotspotNoun: "of all loot pickups",
    next: "Compare with “Where do players die?”. Loot hotspots that are also death hotspots are high-risk, high-reward areas.",
  },
  {
    id: "replay",
    chip: "What happens in a match?",
    question: "What happens in a match?",
    patch: { heatmap: "off", paths: true, humans: true, bots: true, cats: { kill: true, death: true, storm: true, loot: false } },
    seeing: () => "",
    facts: () => [],
    hotspotNoun: "",
    next: "",
  },
];

export const lensById = (id: string | null) => LENSES.find((l) => l.id === id) ?? null;
