import type { Category, DataIndex, GameEvent, Journey, MapData } from "./types";

export async function loadIndex(): Promise<DataIndex> {
  const res = await fetch("/data/index.json");
  if (!res.ok) throw new Error(`index.json: ${res.status}`);
  return res.json();
}

export interface FlatMap {
  journeys: Journey[];
  events: GameEvent[];
}

const cache = new Map<string, Promise<FlatMap>>();

/** Load one map's matches and flatten them into journeys + events (cached per map). */
export function loadMap(mapId: string, categories: Record<string, Category>): Promise<FlatMap> {
  if (!cache.has(mapId)) {
    const p = fetch(`/data/${encodeURIComponent(mapId)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${mapId}.json: ${r.status}`);
        return r.json() as Promise<MapData>;
      })
      .then((data) => flatten(data, categories));
    cache.set(mapId, p);
  }
  return cache.get(mapId)!;
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
