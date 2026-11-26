// What the user is looking at (filters + active question), and how it round-trips through the URL.
// Everything here is pure so it can be unit-tested.
import type { DataIndex, Filters, HeatmapKind } from "./types";
import { lensById, type LensId } from "./lenses";

export const DEFAULT_FILTERS: Filters = {
  mapId: "AmbroseValley",
  date: "all",
  matchId: "all",
  humans: true,
  bots: true,
  paths: true,
  cats: { kill: true, death: true, storm: true, loot: false },
  heatmap: "off",
};

export const NO_CATS = { kill: false, death: false, storm: false, loot: false };
export const HEATMAP_KINDS: HeatmapKind[] = ["off", "traffic", "kill", "death", "storm", "loot"];

export interface ViewState {
  filters: Filters;
  lens: LensId | null;
}

/**
 * A heatmap is unreadable under hundreds of paths and markers, so switching one on clears those
 * layers (the checkboxes visibly untick and can be re-ticked); switching it off restores them.
 */
export function withHeatmapRule(prev: Filters, patch: Partial<Filters>): Partial<Filters> {
  if (patch.heatmap === undefined || patch.heatmap === prev.heatmap) return patch;
  if (prev.heatmap === "off") return { paths: false, cats: NO_CATS, ...patch };
  if (patch.heatmap === "off") return { paths: DEFAULT_FILTERS.paths, cats: DEFAULT_FILTERS.cats, ...patch };
  return patch;
}

/**
 * Read the view from a query string (`?map=…&date=…&match=…&heat=…&q=…`). With no parameters the
 * app opens on the "Where do players go?" question. Map/date/match are checked later, once the
 * real lists are loaded (see sanitizeFilters); unknown heatmap/question values are ignored here.
 */
export function readUrlState(search: string): ViewState {
  const q = new URLSearchParams(search);
  const lens = q.get("q") ? (lensById(q.get("q"))?.id ?? null) : q.has("match") || q.has("heat") ? null : "traffic";
  const base: Filters = {
    ...DEFAULT_FILTERS,
    mapId: q.get("map") ?? DEFAULT_FILTERS.mapId,
    date: q.get("date") ?? "all",
    matchId: q.get("match") ?? "all",
  };
  const l = lensById(lens);
  if (l && l.id !== "replay") return { filters: { ...base, ...l.patch, matchId: base.matchId }, lens: l.id };
  if (l?.id === "replay") return { filters: { ...base, ...l.patch }, lens: base.matchId !== "all" ? l.id : null };
  const heatParam = q.get("heat") as HeatmapKind | null;
  const heatmap = heatParam && HEATMAP_KINDS.includes(heatParam) ? heatParam : "off";
  return { filters: { ...base, ...withHeatmapRule(base, { heatmap }) }, lens: null };
}

/**
 * URL values are untrusted (a link can be edited or truncated). Once the real list of maps, dates and
 * matches is known, replace anything unknown with a safe default; a match always opens on its own map.
 */
export function sanitizeFilters(f: Filters, idx: DataIndex): Filters {
  let { mapId, date, matchId } = f;
  if (!idx.maps.some((m) => m.id === mapId)) mapId = DEFAULT_FILTERS.mapId;
  if (date !== "all" && !idx.dates.includes(date)) date = "all";
  if (matchId !== "all") {
    const meta = idx.matches.find((m) => m.id === matchId);
    if (!meta) matchId = "all";
    else {
      mapId = meta.map;
      if (date !== "all" && date !== meta.date) date = meta.date;
    }
  }
  return { ...f, mapId, date, matchId };
}

/** Apply sanitizeFilters to a view read from the URL; a link to a missing match lands on the default question. */
export function sanitizeView(v: ViewState, idx: DataIndex): ViewState {
  const clean = sanitizeFilters(v.filters, idx);
  const lostMatch = v.filters.matchId !== "all" && clean.matchId === "all";
  if (lostMatch) return { filters: { ...clean, ...lensById("traffic")!.patch, matchId: "all" }, lens: "traffic" };
  return { filters: clean, lens: v.lens };
}

/** The shareable query string for a view (the inverse of readUrlState). */
export function toQueryString({ filters, lens }: ViewState): string {
  const q = new URLSearchParams();
  q.set("map", filters.mapId);
  if (filters.date !== "all") q.set("date", filters.date);
  if (filters.matchId !== "all") q.set("match", filters.matchId);
  if (lens) q.set("q", lens);
  else if (filters.heatmap !== "off") q.set("heat", filters.heatmap);
  return `?${q}`;
}
