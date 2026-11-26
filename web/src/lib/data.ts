import type { Category, DataIndex, GameEvent, Journey, MapData } from "./types";

const TIMEOUT_MS = 15_000; // a download that stalls longer than this is abandoned and retried
const RETRIES = 2;

/**
 * fetch + JSON with a time limit and retries. Mobile connections can silently stall a request;
 * without a time limit the promise would never settle and the UI would wait forever.
 */
async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T; // the time limit also covers reading the body
    } catch (e) {
      if (attempt >= RETRIES) throw new Error(ctrl.signal.aborted ? "the download timed out" : String((e as Error).message ?? e));
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function loadIndex(): Promise<DataIndex> {
  return fetchJson<DataIndex>("/data/index.json");
}

export interface FlatMap {
  journeys: Journey[];
  events: GameEvent[];
}

const cache = new Map<string, Promise<FlatMap>>();

/** Load one map's matches and flatten them into journeys + events. Successful loads are cached per map. */
export function loadMap(mapId: string, categories: Record<string, Category>): Promise<FlatMap> {
  if (!cache.has(mapId)) {
    const p = fetchJson<MapData>(`/data/${encodeURIComponent(mapId)}.json`).then((data) => flatten(data, categories));
    // never remember a failure: the next attempt must start a fresh download
    p.catch(() => cache.delete(mapId));
    cache.set(mapId, p);
  }
  return cache.get(mapId)!;
}

/** Drop a map from the cache (used by the Retry button to force a fresh download). */
export function forgetMap(mapId: string) {
  cache.delete(mapId);
}

/** Quietly download the other maps in the background so switching maps is instant. */
export function prefetchMaps(mapIds: string[], categories: Record<string, Category>) {
  mapIds.forEach((id, i) => setTimeout(() => loadMap(id, categories).catch(() => {}), 800 * (i + 1)));
}

function flatten(data: MapData, categories: Record<string, Category>): FlatMap {
  const journeys: Journey[] = [];
  const events: GameEvent[] = [];
  for (const m of data.matches) {
    for (const p of m.players) {
      const lastT = p.path.length ? p.path[p.path.length - 3] : 0;
      journeys.push({ matchId: m.id, playerId: p.id, bot: p.bot, path: p.path, endT: lastT });
    }
    for (const [t, name, x, y, pi] of m.events) {
      const cat = categories[name];
      if (!cat) continue;
      const p = m.players[pi];
      events.push({ matchId: m.id, playerId: p.id, bot: p.bot, t, name, cat, x, y });
    }
  }
  return { journeys, events };
}
