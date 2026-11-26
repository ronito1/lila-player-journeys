// The words shown in the "What am I looking at?" panel for the current view. Pure, so it is testable.
import type { Category, Filters, MatchMeta } from "./types";
import { CATEGORIES } from "./types";
import type { Lens } from "./lenses";
import type { ViewStats } from "./insights";
import { CATEGORY_LABELS, matchLabel } from "./format";

export interface PanelText {
  title: string;
  seeing: string;
  facts: string[];
  hotspotNoun: string;
  next: string;
}

const HOTSPOT_NOUN: Record<string, string> = {
  traffic: "of all movement",
  kill: "of all kills",
  death: "of all deaths",
  storm: "of storm deaths",
  loot: "of loot pickups",
  events: "of the markers shown",
};

interface Input {
  lens: Lens | null;
  match: MatchMeta | undefined; // a single match is open
  filters: Filters;
  matchCount: number;
  dateText: string;
  stats: ViewStats;
  subjectKind: string | null; // what the hotspots were computed from
}

export function describeView({ lens, match, filters, matchCount, dateText, stats, subjectKind }: Input): PanelText {
  // a single match tells its own story (built separately), so only the title is needed
  if (match) return { title: matchLabel(match), seeing: "", facts: [], hotspotNoun: "", next: "" };

  if (lens && lens.id !== "replay") {
    return {
      title: lens.question,
      seeing: lens.seeing({ matches: matchCount, dateText }),
      facts: lens.facts(stats),
      hotspotNoun: lens.hotspotNoun,
      next: lens.next,
    };
  }

  // a custom view built in the sidebar: describe the layers that are switched on
  const layers: string[] = [];
  if (filters.paths) {
    const who = [filters.humans && "humans", filters.bots && "bots"].filter(Boolean).join(" and ") || "none";
    layers.push(`movement paths (${who})`);
  }
  const cats = CATEGORIES.filter((c) => filters.cats[c]).map((c) => CATEGORY_LABELS[c].toLowerCase());
  if (cats.length) layers.push(`markers for ${cats.join(", ")}`);
  if (filters.heatmap !== "off") {
    const kind = filters.heatmap === "traffic" ? "traffic" : CATEGORY_LABELS[filters.heatmap as Category].toLowerCase();
    layers.push(`a ${kind} heatmap`);
  }
  return {
    title: "Your custom view",
    seeing: layers.length
      ? `Showing ${layers.join(", ")} across ${matchCount} matches (${dateText}).`
      : "Nothing is switched on. Turn on paths, markers or a heatmap in the sidebar, or pick a question above.",
    facts: [],
    hotspotNoun: HOTSPOT_NOUN[subjectKind ?? "events"],
    next: "New here? Pick a question in the bar above for a ready-made view with an explanation.",
  };
}
