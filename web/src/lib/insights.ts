// Turns the current view into plain-language findings: hotspots, place names, headline numbers
// and a "story" for a single match. Everything here is pure and computed in the browser.
import type { GameEvent, Journey } from "./types";

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Hotspot {
  x: number;
  y: number;
  r: number; // radius in map units
  count: number;
  share: number; // 0..1 of all points in the view
  place: string;
}

// Named locations printed on the Grand Rift minimap (pixel positions in 1024 space).
// Ambrose Valley and Lockdown minimaps carry no labels, so those use compass directions.
const POIS: Record<string, Array<[string, number, number]>> = {
  GrandRift: [
    ["Maintenance Bay", 305, 240],
    ["Cave House", 400, 350],
    ["Burnt Zone", 760, 280],
    ["Labour Quarters", 210, 500],
    ["Mine Pit", 490, 560],
    ["Engineer's Quarters", 840, 590],
    ["Gas Station", 480, 815],
  ],
};

/** Playable area = bounding box of everything anyone ever walked on this map. */
export function playableBounds(journeys: Journey[]): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const j of journeys) {
    for (let i = 0; i < j.path.length; i += 3) {
      const x = j.path[i + 1];
      const y = j.path[i + 2];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/** "Mine Pit", "north-east", "centre"… */
export function placeName(x: number, y: number, mapId: string, b: Bounds): string {
  const pois = POIS[mapId];
  if (pois) {
    let best: string | null = null;
    let bestD = 110;
    for (const [name, px, py] of pois) {
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    if (best) return best;
  }
  // 5×5 compass over the playable area: edge / side / centre in each direction
  const fx = (x - b.minX) / Math.max(1, b.maxX - b.minX);
  const fy = (y - b.minY) / Math.max(1, b.maxY - b.minY);
  const band = (f: number) => Math.min(4, Math.max(0, Math.floor(f * 5)));
  const ROW = ["north edge", "north", "", "south", "south edge"];
  const COL = ["west edge", "west", "", "east", "east edge"];
  const r = ROW[band(fy)];
  const c = COL[band(fx)];
  if (!r && !c) return "map centre";
  if (!r) return c.endsWith("edge") ? c : `${c} of centre`;
  if (!c) return r.endsWith("edge") ? r : `${r} of centre`;
  const edge = r.endsWith("edge") || c.endsWith("edge");
  return `${r.replace(" edge", "")}-${c.replace(" edge", "")}${edge ? " edge" : ""}`;
}

/**
 * Top-k dense areas: bin into a 16×16 grid, score each cell by its 3×3 neighbourhood,
 * pick the best, suppress its neighbours, repeat.
 */
export function findHotspots(points: Array<[number, number]>, mapSize: number, mapId: string, b: Bounds, k = 3): Hotspot[] {
  if (points.length < 5) return [];
  const G = 16;
  const cell = mapSize / G;
  const n = new Float64Array(G * G);
  const sx = new Float64Array(G * G);
  const sy = new Float64Array(G * G);
  for (const [x, y] of points) {
    const cx = Math.min(G - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(G - 1, Math.max(0, Math.floor(y / cell)));
    const i = cy * G + cx;
    n[i]++;
    sx[i] += x;
    sy[i] += y;
  }
  const around = (cx: number, cy: number) => {
    let c = 0, ax = 0, ay = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue;
        const i = yy * G + xx;
        c += n[i];
        ax += sx[i];
        ay += sy[i];
      }
    return { c, x: ax / Math.max(1, c), y: ay / Math.max(1, c) };
  };
  const used = new Uint8Array(G * G);
  const out: Hotspot[] = [];
  for (let pick = 0; pick < k; pick++) {
    let best = -1, bestC = 0;
    for (let cy = 0; cy < G; cy++)
      for (let cx = 0; cx < G; cx++) {
        if (used[cy * G + cx]) continue;
        const { c } = around(cx, cy);
        if (c > bestC) {
          bestC = c;
          best = cy * G + cx;
        }
      }
    if (best < 0 || bestC < 2) break;
    const bx = best % G, by = Math.floor(best / G);
    const a = around(bx, by);
    let place = placeName(a.x, a.y, mapId, b);
    const twin = out.find((o) => o.place === place);
    if (twin) {
      // same area name twice: say which part of it this one is
      const dx = a.x - twin.x, dy = a.y - twin.y;
      const dir = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "north" : "south") : dx < 0 ? "west" : "east";
      place = `${place}, ${dir} part`;
    }
    out.push({ x: a.x, y: a.y, r: cell * 1.6, count: a.c, share: a.c / points.length, place });
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = bx + dx, yy = by + dy;
        if (xx >= 0 && yy >= 0 && xx < G && yy < G) used[yy * G + xx] = 1;
      }
  }
  return out;
}

/** Headline numbers for the events currently in view. */
export function viewStats(events: GameEvent[], journeys: Journey[]) {
  const humanRuns = journeys.filter((j) => !j.bot).length;
  let botKillsByHumans = 0, pvpKills = 0, diedToBot = 0, diedToPlayer = 0, diedToStorm = 0, humanLoot = 0;
  const stormTimes: number[] = [];
  for (const e of events) {
    if (e.bot) continue;
    if (e.name === "BotKill") botKillsByHumans++;
    else if (e.name === "Kill") pvpKills++;
    else if (e.name === "BotKilled") diedToBot++;
    else if (e.name === "Killed") diedToPlayer++;
    else if (e.name === "KilledByStorm") {
      diedToStorm++;
      stormTimes.push(e.t);
    } else if (e.name === "Loot") humanLoot++;
  }
  stormTimes.sort((a, b) => a - b);
  const humanDeaths = diedToBot + diedToPlayer + diedToStorm;
  return {
    humanRuns,
    botKillsByHumans,
    pvpKills,
    diedToBot,
    diedToPlayer,
    diedToStorm,
    humanDeaths,
    humanLoot,
    stormMedianT: stormTimes.length ? stormTimes[Math.floor(stormTimes.length / 2)] : null,
    stormFirstT: stormTimes.length ? stormTimes[0] : null,
  };
}
export type ViewStats = ReturnType<typeof viewStats>;

export const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------------- single-match story ----------------

export interface Moment {
  t: number;
  ev: GameEvent;
  text: string;
  place: string;
}

export interface MatchStory {
  summary: string;
  moments: Moment[];
  lootCount: number;
}

const who = (e: GameEvent) => (e.bot ? "A bot" : "The player");

function momentText(e: GameEvent): string {
  switch (e.name) {
    case "BotKill":
      return e.bot ? "A bot got a kill" : "The player killed a bot";
    case "Kill":
      return "The player killed another player";
    case "BotKilled":
      return e.bot ? "A bot was killed" : "The player was killed by a bot";
    case "Killed":
      return "The player was killed by another player";
    case "KilledByStorm":
      return `${who(e)} was caught by the storm`;
    default:
      return e.name;
  }
}

export function matchStory(events: GameEvent[], journeys: Journey[], mapId: string, b: Bounds, clock: (s: number) => string): MatchStory {
  const humans = journeys.filter((j) => !j.bot);
  const bots = journeys.filter((j) => j.bot);
  const human = events.filter((e) => !e.bot);
  const loot = human.filter((e) => e.cat === "loot").length;
  const kills = human.filter((e) => e.cat === "kill").length;
  const death = human.find((e) => e.cat === "death" || e.cat === "storm");

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const start = humans[0]?.path.length ? placeName(humans[0].path[1], humans[0].path[2], mapId, b) : null;
  const cast = `${humans.length === 1 ? "One human player" : `${humans.length} human players`}${bots.length ? ` and ${plural(bots.length, "tracked bot")}` : ""}.`;
  const did = `The player ${start ? `started at the ${start}, ` : ""}picked up ${plural(loot, "item")} and got ${plural(kills, "kill")}`;
  let ending: string;
  if (death) {
    const how = death.name === "KilledByStorm" ? "was caught by the storm" : death.name === "Killed" ? "was killed by another player" : "was killed by a bot";
    ending = `, then ${how} at ${clock(death.t)} (${placeName(death.x, death.y, mapId, b)}).`;
  } else {
    ending = ", and survived to the end of the recording (most likely extracted).";
  }
  const parts = [cast, did + ending];

  const moments = events
    .filter((e) => e.cat !== "loot")
    .sort((a, b2) => a.t - b2.t)
    .map((e) => ({ t: e.t, ev: e, text: momentText(e), place: placeName(e.x, e.y, mapId, b) }));
  return { summary: parts.join(" "), moments, lootCount: loot };
}
