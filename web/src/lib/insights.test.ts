import { describe, expect, it } from "vitest";
import { findHotspots, gridRef, matchStory, placeName, viewStats, type Bounds } from "./insights";
import { clock } from "./format";
import type { GameEvent, Journey } from "./types";

const bounds: Bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };

const ev = (name: string, x: number, y: number, t = 0, bot = false): GameEvent => ({
  matchId: "m", playerId: bot ? "1440" : "human", bot, t, name, x, y,
  cat: name === "Loot" ? "loot" : name === "KilledByStorm" ? "storm" : name.endsWith("Killed") ? "death" : "kill",
});

describe("placeName", () => {
  it("uses the named location on Grand Rift", () => {
    expect(placeName(490, 560, "GrandRift", bounds)).toBe("Mine Pit");
  });

  it("falls back to compass directions on unlabelled maps", () => {
    expect(placeName(500, 500, "AmbroseValley", bounds)).toBe("map centre");
    expect(placeName(50, 50, "AmbroseValley", bounds)).toBe("north-west edge");
    expect(placeName(300, 500, "AmbroseValley", bounds)).toBe("west of centre");
  });
});

describe("findHotspots", () => {
  it("ranks the densest cluster first and reports its share", () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 60; i++) pts.push([200 + (i % 5), 200 + (i % 7)]); // big cluster
    for (let i = 0; i < 20; i++) pts.push([800 + (i % 5), 800 + (i % 7)]); // small cluster
    const hs = findHotspots(pts, 1024, "AmbroseValley", bounds);
    expect(hs[0].x).toBeCloseTo(202, 0);
    expect(hs[0].share).toBeCloseTo(0.75, 2);
    expect(hs[1].share).toBeCloseTo(0.25, 2);
  });

  it("never gives two hotspots the same name", () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 40; i++) pts.push([480, 470]); // two separate clusters, both inside Mine Pit's radius
    for (let i = 0; i < 20; i++) pts.push([480, 650]);
    const names = findHotspots(pts, 1024, "GrandRift", bounds).map((h) => h.place);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns nothing for too little data", () => {
    expect(findHotspots([[1, 1]], 1024, "AmbroseValley", bounds)).toEqual([]);
  });
});

describe("viewStats", () => {
  it("splits player deaths by cause and ignores bot-logged events", () => {
    const s = viewStats(
      [ev("BotKilled", 0, 0), ev("BotKilled", 0, 0), ev("KilledByStorm", 0, 0, 700), ev("Killed", 0, 0), ev("BotKilled", 0, 0, 0, true)],
      [],
    );
    expect(s).toMatchObject({ diedToBot: 2, diedToStorm: 1, diedToPlayer: 1, humanDeaths: 4, stormMedianT: 700 });
  });
});

describe("matchStory", () => {
  const journeys: Journey[] = [{ matchId: "m", playerId: "human", bot: false, path: [0, 100, 100, 60, 500, 500], endT: 60 }];

  it("says how the player died, when and where", () => {
    const story = matchStory([ev("Loot", 1, 1, 10), ev("BotKill", 1, 1, 20), ev("BotKilled", 490, 560, 61)], journeys, "GrandRift", bounds, clock);
    expect(story.summary).toContain("picked up 1 item and got 1 kill");
    expect(story.summary).toContain("was killed by a bot at 1:01 (Mine Pit)");
    expect(story.moments.map((m) => m.t)).toEqual([20, 61]); // loot is summarised, not listed
  });

  it("says the player survived when there is no death", () => {
    const story = matchStory([ev("Loot", 1, 1, 10)], journeys, "AmbroseValley", bounds, clock);
    expect(story.summary).toContain("survived to the end of the recording");
  });
});

describe("gridRef", () => {
  it("names the 16×16 grid square shown on the map rulers", () => {
    expect(gridRef(0, 0)).toBe("A1");
    expect(gridRef(490, 560)).toBe("H9"); // Mine Pit
    expect(gridRef(1024, 1024)).toBe("P16"); // the far edge stays on the grid
  });
});
