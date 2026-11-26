import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, readUrlState, sanitizeFilters, sanitizeView, toQueryString, withHeatmapRule } from "./viewState";
import type { DataIndex, MatchMeta } from "./types";

const match = (id: string, map: string, date: string): MatchMeta => ({
  id, map, date, start: 0, duration: 300, humans: 1, bots: 0, kills: 0, deaths: 0, storm: 0, loot: 0,
});

const index: DataIndex = {
  mapSize: 1024,
  maps: ["AmbroseValley", "GrandRift", "Lockdown"].map((id) => ({ id, scale: 1, originX: 0, originZ: 0, image: "" })),
  dates: ["February_10", "February_11"],
  eventCategories: {},
  matches: [match("m-ambrose", "AmbroseValley", "February_10"), match("m-rift", "GrandRift", "February_11")],
};

describe("readUrlState", () => {
  it("opens on the 'Where do players go?' question when the link has no parameters", () => {
    const v = readUrlState("");
    expect(v.lens).toBe("traffic");
    expect(v.filters.heatmap).toBe("traffic");
  });

  it("ignores an unknown heatmap value instead of crashing", () => {
    expect(readUrlState("?heat=foo").filters.heatmap).toBe("off");
  });

  it("ignores an unknown question", () => {
    expect(readUrlState("?q=nonsense&map=Lockdown").lens).toBeNull();
  });
});

describe("sanitizeFilters (URL values are untrusted)", () => {
  it("replaces an unknown or malicious map with the default", () => {
    expect(sanitizeFilters({ ...DEFAULT_FILTERS, mapId: "../index" }, index).mapId).toBe("AmbroseValley");
    expect(sanitizeFilters({ ...DEFAULT_FILTERS, mapId: "<img src=x onerror=alert(1)>" }, index).mapId).toBe("AmbroseValley");
  });

  it("replaces an unknown date with 'all'", () => {
    expect(sanitizeFilters({ ...DEFAULT_FILTERS, date: "February_99" }, index).date).toBe("all");
  });

  it("drops a match that does not exist", () => {
    expect(sanitizeFilters({ ...DEFAULT_FILTERS, matchId: "nope" }, index).matchId).toBe("all");
  });

  it("opens a match on its own map even if the link names another map", () => {
    const f = sanitizeFilters({ ...DEFAULT_FILTERS, mapId: "Lockdown", matchId: "m-rift" }, index);
    expect(f.mapId).toBe("GrandRift");
  });
});

describe("sanitizeView", () => {
  it("sends a link to a missing match to the default question rather than an empty view", () => {
    const v = sanitizeView(readUrlState("?match=nope&q=replay"), index);
    expect(v.lens).toBe("traffic");
    expect(v.filters.matchId).toBe("all");
  });
});

describe("toQueryString", () => {
  it("round-trips through readUrlState", () => {
    const v = readUrlState("?map=GrandRift&date=February_11&q=deaths");
    const again = readUrlState(toQueryString(v));
    expect(again).toEqual(v);
  });
});

describe("withHeatmapRule", () => {
  it("clears paths and markers when a heatmap is switched on", () => {
    const patch = withHeatmapRule(DEFAULT_FILTERS, { heatmap: "death" });
    expect(patch.paths).toBe(false);
    expect(Object.values(patch.cats!).every((v) => !v)).toBe(true);
  });

  it("restores the default layers when the heatmap is switched off", () => {
    const patch = withHeatmapRule({ ...DEFAULT_FILTERS, heatmap: "kill" }, { heatmap: "off" });
    expect(patch.paths).toBe(true);
    expect(patch.cats).toEqual(DEFAULT_FILTERS.cats);
  });
});
