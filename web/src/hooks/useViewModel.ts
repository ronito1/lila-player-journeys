import { useMemo } from "react";
import type { FlatMap } from "../lib/data";
import { buildHeatmap } from "../lib/heatmap";
import { findHotspots, matchStory, playableBounds, viewStats } from "../lib/insights";
import { clock } from "../lib/format";
import type { Category, DataIndex, Filters } from "../lib/types";

type Pt = [number, number];

interface Args {
  index: DataIndex | null;
  mapData: FlatMap | null;
  filters: Filters;
  selectedIds: Set<string>; // matches in the current selection
  singleMatch: boolean;
  t: number; // playhead, seconds since match start
}

/**
 * Everything derived from (data × filters × playhead): what to draw, the counts, the heatmap,
 * the hotspots and the match story. All memoised so playback only recomputes what changed.
 */
export function useViewModel({ index, mapData, filters, selectedIds, singleMatch, t }: Args) {
  const { humans, bots } = filters;

  const journeys = useMemo(
    () => (mapData ? mapData.journeys.filter((j) => selectedIds.has(j.matchId) && (j.bot ? bots : humans)) : []),
    [mapData, selectedIds, humans, bots],
  );

  // events up to the playhead, before the per-category toggles (so the counts stay meaningful)
  const eventsInTime = useMemo(
    () => (mapData ? mapData.events.filter((e) => selectedIds.has(e.matchId) && (e.bot ? bots : humans) && e.t <= t) : []),
    [mapData, selectedIds, humans, bots, t],
  );
  const visibleEvents = useMemo(() => eventsInTime.filter((e) => filters.cats[e.cat]), [eventsInTime, filters.cats]);

  const counts = useMemo(() => {
    const c = { kill: 0, death: 0, storm: 0, loot: 0 } as Record<Category, number>;
    for (const e of eventsInTime) c[e.cat]++;
    return { ...c, humans: journeys.filter((j) => !j.bot).length, bots: journeys.filter((j) => j.bot).length };
  }, [eventsInTime, journeys]);

  const trafficPoints = useMemo(() => {
    const pts: Pt[] = [];
    for (const j of journeys) for (let i = 0; i < j.path.length && j.path[i] <= t; i += 3) pts.push([j.path[i + 1], j.path[i + 2]]);
    return pts;
  }, [journeys, t]);

  const heatPoints = useMemo((): Pt[] | null => {
    if (filters.heatmap === "off") return null;
    if (filters.heatmap === "traffic") return trafficPoints;
    return eventsInTime.filter((e) => e.cat === filters.heatmap).map((e): Pt => [e.x, e.y]);
  }, [filters.heatmap, trafficPoints, eventsInTime]);

  const heat = useMemo(() => (index && heatPoints ? buildHeatmap(heatPoints, index.mapSize) : null), [index, heatPoints]);

  // what the hotspots describe: the heatmap if one is on, else the visible markers, else movement
  const subject = useMemo((): { kind: string; points: Pt[] } | null => {
    if (singleMatch) return null;
    if (heatPoints) return { kind: filters.heatmap, points: heatPoints };
    if (visibleEvents.length) {
      const cats = new Set(visibleEvents.map((e) => e.cat));
      return { kind: cats.size === 1 ? [...cats][0] : "events", points: visibleEvents.map((e): Pt => [e.x, e.y]) };
    }
    if (filters.paths) return { kind: "traffic", points: trafficPoints };
    return null;
  }, [singleMatch, heatPoints, filters.heatmap, filters.paths, visibleEvents, trafficPoints]);

  const bounds = useMemo(() => (mapData ? playableBounds(mapData.journeys) : null), [mapData]);

  const hotspots = useMemo(
    () => (subject && index && bounds ? findHotspots(subject.points, index.mapSize, filters.mapId, bounds) : []),
    [subject, index, bounds, filters.mapId],
  );

  const stats = useMemo(() => viewStats(eventsInTime, journeys), [eventsInTime, journeys]);

  const story = useMemo(() => {
    if (!singleMatch || !mapData || !bounds) return null;
    const evs = mapData.events.filter((e) => e.matchId === filters.matchId);
    const js = mapData.journeys.filter((j) => j.matchId === filters.matchId);
    return matchStory(evs, js, filters.mapId, bounds, clock);
  }, [singleMatch, mapData, bounds, filters.matchId, filters.mapId]);

  // combat moments marked on the timeline track
  const ticks = useMemo(
    () =>
      singleMatch && mapData
        ? mapData.events.filter((e) => selectedIds.has(e.matchId) && e.cat !== "loot" && (e.bot ? bots : humans))
        : [],
    [singleMatch, mapData, selectedIds, humans, bots],
  );

  return { journeys, visibleEvents, counts, heat, hotspots, subjectKind: subject?.kind ?? null, stats, story, ticks };
}
