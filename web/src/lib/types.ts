// Shapes of the JSON produced by pipeline/build_data.py

export type Category = "kill" | "death" | "storm" | "loot";
export const CATEGORIES: Category[] = ["kill", "death", "storm", "loot"];

export interface MapInfo {
  id: string;
  scale: number;
  originX: number;
  originZ: number;
  image: string;
}

export interface MatchMeta {
  id: string;
  map: string;
  date: string; // folder name, e.g. "February_10"
  start: number; // unix seconds
  duration: number; // seconds
  humans: number;
  bots: number;
  kills: number;
  deaths: number;
  storm: number;
  loot: number;
}

export interface DataIndex {
  mapSize: number;
  maps: MapInfo[];
  dates: string[];
  eventCategories: Record<string, Category>;
  matches: MatchMeta[];
}

/** [t, rawEventName, px, py, playerIndexInMatch] */
export type RawEvent = [number, string, number, number, number];

export interface RawPlayer {
  id: string;
  bot: boolean;
  /** flat [t, px, py, t, px, py, ...]; t = seconds since match start, px/py in 1024 minimap space */
  path: number[];
}

export interface RawMatch {
  id: string;
  players: RawPlayer[];
  events: RawEvent[];
}

export interface MapData {
  map: string;
  matches: RawMatch[];
}

// ---- view models (flattened once per map) ----

export interface Journey {
  matchId: string;
  playerId: string;
  bot: boolean;
  path: number[];
  endT: number;
}

export interface GameEvent {
  matchId: string;
  playerId: string;
  bot: boolean;
  t: number;
  name: string; // raw event name, e.g. "BotKilled"
  cat: Category;
  x: number;
  y: number;
}

export type HeatmapKind = "off" | "traffic" | Category;

/** Everything the user can choose; together with the active question it defines the view. */
export interface Filters {
  mapId: string;
  date: string; // "all" or a folder name such as "February_10"
  matchId: string; // "all" or a match id
  humans: boolean;
  bots: boolean;
  paths: boolean;
  cats: Record<Category, boolean>;
  heatmap: HeatmapKind;
}
