import type { Category, MatchMeta } from "./types";

export const MAP_LABELS: Record<string, string> = {
  AmbroseValley: "Ambrose Valley",
  GrandRift: "Grand Rift",
  Lockdown: "Lockdown",
};

/** "February_10" -> "Feb 10" */
export function dateLabel(d: string): string {
  const [month, day] = d.split("_");
  return `${month.slice(0, 3)} ${day}`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function matchLabel(m: MatchMeta): string {
  const start = new Date(m.start * 1000).toISOString().slice(11, 16);
  const fights = m.kills + m.deaths + m.storm;
  const parts = [`${dateLabel(m.date)}, ${start}`, clock(m.duration)];
  if (m.bots) parts.push(`${m.bots} bots`);
  if (fights) parts.push(`${fights} fights`);
  return parts.join(" · ");
}

export const CATEGORY_LABELS: Record<Category, string> = {
  kill: "Kills",
  death: "Deaths",
  storm: "Storm deaths",
  loot: "Loot pickups",
};

/** Plain-language description of a raw event from the point of view of whoever logged it. */
export function describeEvent(name: string, bot: boolean): string {
  switch (name) {
    case "Kill":
      return "Player killed another player";
    case "Killed":
      return "Player was killed by another player";
    case "BotKill":
      return bot ? "Bot killed a target" : "Player killed a bot";
    case "BotKilled":
      return bot ? "Bot was killed" : "Player was killed by a bot";
    case "KilledByStorm":
      return "Died to the storm";
    case "Loot":
      return "Picked up an item";
    default:
      return name;
  }
}
