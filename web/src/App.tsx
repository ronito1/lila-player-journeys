import { useEffect, useMemo, useState } from "react";
import Sidebar, { type Filters } from "./components/Sidebar";
import MapView, { type FocusRequest } from "./components/MapView";
import Timeline from "./components/Timeline";
import QuestionBar from "./components/QuestionBar";
import InsightPanel from "./components/InsightPanel";
import Tour, { WelcomeCard, type TourStep } from "./components/Tour";
import { IconHelp, IconLink, IconMenu, IconMoon, IconSun } from "./components/Icons";
import { useTheme } from "./lib/theme";
import { forgetMap, loadIndex, loadMap, prefetchMaps, type FlatMap } from "./lib/data";
import { buildHeatmap } from "./lib/heatmap";
import { findHotspots, matchStory, playableBounds, viewStats, type Moment } from "./lib/insights";
import { lensById, type LensId } from "./lib/lenses";
import type { Category, DataIndex } from "./lib/types";
import { CATEGORIES } from "./lib/types";
import { CATEGORY_LABELS, MAP_LABELS, clock, dateLabel, matchLabel } from "./lib/format";

const DEFAULT_FILTERS: Filters = {
  mapId: "AmbroseValley",
  date: "all",
  matchId: "all",
  humans: true,
  bots: true,
  paths: true,
  cats: { kill: true, death: true, storm: true, loot: false },
  heatmap: "off",
};

const NO_CATS = { kill: false, death: false, storm: false, loot: false };
const TOUR_SEEN_KEY = "lila.tourSeen";

/**
 * A heatmap is unreadable under hundreds of paths and markers, so switching one on clears those
 * layers (the checkboxes visibly untick and can be re-ticked); switching it off restores them.
 */
function withHeatmapRule(prev: Filters, patch: Partial<Filters>): Partial<Filters> {
  if (patch.heatmap === undefined || patch.heatmap === prev.heatmap) return patch;
  if (prev.heatmap === "off") return { paths: false, cats: NO_CATS, ...patch };
  if (patch.heatmap === "off") return { paths: DEFAULT_FILTERS.paths, cats: DEFAULT_FILTERS.cats, ...patch };
  return patch;
}

/** Map / date / match / heatmap / question live in the URL so any view can be shared as a link. */
function initialState(): { filters: Filters; lens: LensId | null } {
  const q = new URLSearchParams(window.location.search);
  const lens = q.get("q") ? (lensById(q.get("q"))?.id ?? null) : q.has("match") || q.has("heat") ? null : "traffic";
  const base: Filters = {
    ...DEFAULT_FILTERS,
    mapId: q.get("map") ?? DEFAULT_FILTERS.mapId,
    date: q.get("date") ?? "all",
    matchId: q.get("match") ?? "all",
  };
  const l = lensById(lens);
  if (l && l.id !== "replay") return { filters: { ...base, ...l.patch, matchId: base.matchId }, lens };
  if (l?.id === "replay") return { filters: { ...base, ...l.patch }, lens: base.matchId !== "all" ? lens : null };
  const heatParam = q.get("heat") as Filters["heatmap"] | null;
  const heatmap = heatParam && HEATMAP_KINDS.includes(heatParam) ? heatParam : "off"; // ignore unknown values
  return { filters: { ...base, ...withHeatmapRule(base, { heatmap }) }, lens: null };
}

const HEATMAP_KINDS: Filters["heatmap"][] = ["off", "traffic", "kill", "death", "storm", "loot"];

/**
 * URL values are untrusted (a link can be edited or truncated). Once the real list of maps, dates and
 * matches is known, replace anything unknown with a safe default; a match opens on its own map.
 */
function sanitizeFilters(f: Filters, idx: DataIndex): Filters {
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

const HOTSPOT_NOUN: Record<string, string> = {
  traffic: "of all movement",
  kill: "of all kills",
  death: "of all deaths",
  storm: "of storm deaths",
  loot: "of loot pickups",
  events: "of the markers shown",
};

export default function App() {
  const [init] = useState(initialState);
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [mapData, setMapData] = useState<FlatMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [lens, setLens] = useState<LensId | null>(init.lens);
  const [time, setTime] = useState(Infinity); // Infinity = show the whole match
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(TOUR_SEEN_KEY));
  const [copied, setCopied] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [slowLoad, setSlowLoad] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 900px)");

  /**
   * Full screen = only the map and the timeline. Uses the browser's real full-screen mode where it
   * exists (desktop, Android); on iPhone, which doesn't allow it for web pages, the page itself
   * hides everything else, which looks the same.
   */
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    const el = document.documentElement;
    if (next && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setFullscreen(false); // Esc in native full screen
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const retryMap = () => {
    forgetMap(filters.mapId);
    setReloadKey((k) => k + 1);
  };

  const startTour = () => {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    setShowWelcome(false);
    setTourOpen(true);
  };
  const dismissWelcome = () => {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    setShowWelcome(false);
  };
  const onTourStep = (step: TourStep) => {
    if (isMobile) setDrawerOpen(!!step.inSidebar);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the URL bar still holds the shareable link */
    }
  };

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...withHeatmapRule(f, patch) }));
    if ("mapId" in patch || "date" in patch || "matchId" in patch) {
      setPlaying(false);
      setTime(Infinity);
    }
  };

  /** Manual changes in the sidebar. Map/date keep the current question; anything else makes it a custom view. */
  const sidebarChange = (patch: Partial<Filters>) => {
    const scopeOnly = Object.keys(patch).every((k) => k === "mapId" || k === "date" || k === "matchId");
    const leavesMatch = lens === "replay" && (patch.matchId === "all" || "mapId" in patch || "date" in patch);
    const picksMatch = patch.matchId !== undefined && patch.matchId !== "all";
    if (picksMatch) {
      openMatch(patch.matchId!);
      return;
    }
    if (!scopeOnly || leavesMatch) setLens(null);
    update(patch);
  };

  const openMatch = (id: string) => {
    update({ ...lensById("replay")!.patch, matchId: id });
    setLens("replay");
  };

  const pickLens = (id: LensId) => {
    const l = lensById(id)!;
    setLens(id);
    if (id === "replay") {
      // replay the most eventful match in the current map/date (or keep the open one)
      const candidates = matchesForMap;
      const match =
        filters.matchId !== "all"
          ? filters.matchId
          : [...candidates].sort((a, b) => b.kills + b.deaths + b.storm - (a.kills + a.deaths + a.storm))[0]?.id;
      if (!match) return;
      update({ ...l.patch, matchId: match });
      setTime(0);
      setPlaying(true);
      return;
    }
    update(l.patch);
  };

  // --- data loading -----------------------------------------------------------------
  useEffect(() => {
    loadIndex()
      .then((idx) => {
        // validate the URL-provided map/date/match before anything is fetched with them
        const clean = sanitizeFilters(init.filters, idx);
        const lostMatch = init.filters.matchId !== "all" && clean.matchId === "all";
        if (lostMatch) {
          // the linked match doesn't exist: land on the default question instead of an empty view
          setLens("traffic");
          setFilters((f) => ({ ...f, ...lensById("traffic")!.patch, mapId: clean.mapId, date: clean.date, matchId: "all" }));
        } else {
          setFilters((f) => ({ ...f, mapId: clean.mapId, date: clean.date, matchId: clean.matchId }));
        }
        setIndex(idx);
      })
      .catch((e) => setError(String(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!index || !index.maps.some((m) => m.id === filters.mapId)) return;
    let current = true; // ignore answers for a map the user has already switched away from
    setMapData(null);
    setMapError(null);
    setSlowLoad(false);
    const slowTimer = setTimeout(() => current && setSlowLoad(true), 6000);
    loadMap(filters.mapId, index.eventCategories)
      .then((d) => current && setMapData(d))
      .catch((e) => current && setMapError(String((e as Error).message ?? e)))
      .finally(() => clearTimeout(slowTimer));
    return () => {
      current = false;
      clearTimeout(slowTimer);
    };
  }, [index, filters.mapId, reloadKey]);

  // once the first map is on screen, quietly download the others so switching is instant
  const loadedOnce = mapData !== null;
  useEffect(() => {
    if (!index || !loadedOnce) return;
    prefetchMaps(index.maps.map((m) => m.id).filter((id) => id !== filters.mapId), index.eventCategories);
  }, [index, loadedOnce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("map", filters.mapId);
    if (filters.date !== "all") q.set("date", filters.date);
    if (filters.matchId !== "all") q.set("match", filters.matchId);
    if (lens) q.set("q", lens);
    else if (filters.heatmap !== "off") q.set("heat", filters.heatmap);
    window.history.replaceState(null, "", `?${q}`);
  }, [filters.mapId, filters.date, filters.matchId, filters.heatmap, lens]);

  // close the drawer after picking a match on mobile, so the map is visible
  useEffect(() => {
    if (isMobile) setDrawerOpen(false);
  }, [filters.matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- selection --------------------------------------------------------------------
  const matchesForMap = useMemo(
    () => (index ? index.matches.filter((m) => m.map === filters.mapId && (filters.date === "all" || m.date === filters.date)) : []),
    [index, filters.mapId, filters.date],
  );
  const singleMatch = filters.matchId !== "all";
  const selectedIds = useMemo(
    () => new Set(singleMatch ? [filters.matchId] : matchesForMap.map((m) => m.id)),
    [singleMatch, filters.matchId, matchesForMap],
  );
  const maxTime = useMemo(() => {
    const sel = matchesForMap.filter((m) => selectedIds.has(m.id));
    return sel.reduce((mx, m) => Math.max(mx, m.duration), 0);
  }, [matchesForMap, selectedIds]);
  const t = Math.min(time, maxTime);

  const playerOk = (bot: boolean) => (bot ? filters.bots : filters.humans);

  const journeys = useMemo(
    () => (mapData ? mapData.journeys.filter((j) => selectedIds.has(j.matchId) && playerOk(j.bot)) : []),
    [mapData, selectedIds, filters.humans, filters.bots], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // events in the selection up to the playhead (before category toggles -> used for counts)
  const eventsInTime = useMemo(
    () => (mapData ? mapData.events.filter((e) => selectedIds.has(e.matchId) && playerOk(e.bot) && e.t <= t) : []),
    [mapData, selectedIds, filters.humans, filters.bots, t], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const visibleEvents = useMemo(() => eventsInTime.filter((e) => filters.cats[e.cat]), [eventsInTime, filters.cats]);

  const counts = useMemo(() => {
    const c = { kill: 0, death: 0, storm: 0, loot: 0 } as Record<Category, number>;
    for (const e of eventsInTime) c[e.cat]++;
    return { ...c, humans: journeys.filter((j) => !j.bot).length, bots: journeys.filter((j) => j.bot).length };
  }, [eventsInTime, journeys]);

  // positions up to the playhead (traffic)
  const trafficPoints = useMemo(() => {
    const pts: Array<[number, number]> = [];
    for (const j of journeys) for (let i = 0; i < j.path.length && j.path[i] <= t; i += 3) pts.push([j.path[i + 1], j.path[i + 2]]);
    return pts;
  }, [journeys, t]);

  const heatPoints = useMemo((): Array<[number, number]> | null => {
    if (filters.heatmap === "off") return null;
    if (filters.heatmap === "traffic") return trafficPoints;
    return eventsInTime.filter((e) => e.cat === filters.heatmap).map((e) => [e.x, e.y]);
  }, [filters.heatmap, trafficPoints, eventsInTime]);

  const heat = useMemo(() => (index && heatPoints ? buildHeatmap(heatPoints, index.mapSize) : null), [index, heatPoints]);

  // --- explanation: what the view shows, where the hotspots are, the story of a match -----
  const bounds = useMemo(() => (mapData ? playableBounds(mapData.journeys) : null), [mapData]);

  const subject = useMemo((): { kind: string; points: Array<[number, number]> } | null => {
    if (singleMatch) return null;
    if (heatPoints) return { kind: filters.heatmap, points: heatPoints };
    if (visibleEvents.length) {
      const cats = new Set(visibleEvents.map((e) => e.cat));
      return { kind: cats.size === 1 ? [...cats][0] : "events", points: visibleEvents.map((e) => [e.x, e.y]) };
    }
    if (filters.paths) return { kind: "traffic", points: trafficPoints };
    return null;
  }, [singleMatch, heatPoints, filters.heatmap, filters.paths, visibleEvents, trafficPoints]);

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

  const ticks = useMemo(
    () => (singleMatch && mapData ? mapData.events.filter((e) => selectedIds.has(e.matchId) && e.cat !== "loot" && playerOk(e.bot)) : []),
    [singleMatch, mapData, selectedIds, filters.humans, filters.bots], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- playback ---------------------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((cur) => {
        const next = Math.min(cur, maxTime) + dt * speed;
        if (next >= maxTime) {
          setPlaying(false);
          return Infinity;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, maxTime]);

  const togglePlay = () => {
    if (!playing && t >= maxTime) setTime(0); // replay from the start
    setPlaying((p) => !p);
  };

  const focusOn = (x: number, y: number, zoom: number) => setFocus({ x, y, zoom, nonce: Date.now() });
  const seekTo = (m: Moment) => {
    setPlaying(false);
    setTime(m.t);
    focusOn(m.ev.x, m.ev.y, 2.5);
  };

  // --- render -----------------------------------------------------------------------
  if (error) return <div className="splash error">Could not load data: {error}</div>;
  if (!index) return <div className="splash">Loading telemetry…</div>;

  const mapInfo = index.maps.find((m) => m.id === filters.mapId) ?? index.maps[0];
  const selectedMatch = singleMatch ? index.matches.find((m) => m.id === filters.matchId) : undefined;
  const backdrop = theme === "dark" ? "#0b0d12" : "#e4e7ed";

  const activeLens = lensById(lens);
  const dateText = filters.date === "all" ? "Feb 10–14" : dateLabel(filters.date);
  const panel = (() => {
    if (selectedMatch) return { title: matchLabel(selectedMatch), seeing: "", facts: [], noun: "", next: "" };
    if (activeLens && activeLens.id !== "replay") {
      return {
        title: activeLens.question,
        seeing: activeLens.seeing({ matches: matchesForMap.length, dateText }),
        facts: activeLens.facts(stats),
        noun: activeLens.hotspotNoun,
        next: activeLens.next,
      };
    }
    const layers: string[] = [];
    if (filters.paths) layers.push(`movement paths (${[filters.humans && "humans", filters.bots && "bots"].filter(Boolean).join(" and ") || "none"})`);
    const cats = CATEGORIES.filter((c) => filters.cats[c]).map((c) => CATEGORY_LABELS[c].toLowerCase());
    if (cats.length) layers.push(`markers for ${cats.join(", ")}`);
    if (filters.heatmap !== "off") layers.push(`a ${filters.heatmap === "traffic" ? "traffic" : CATEGORY_LABELS[filters.heatmap as Category].toLowerCase()} heatmap`);
    return {
      title: "Your custom view",
      seeing: layers.length
        ? `Showing ${layers.join(", ")} across ${matchesForMap.length} matches (${dateText}).`
        : "Nothing is switched on. Turn on paths, markers or a heatmap in the sidebar, or pick a question above.",
      facts: [] as string[],
      noun: HOTSPOT_NOUN[subject?.kind ?? "events"],
      next: "New here? Pick a question in the bar above for a ready-made view with an explanation.",
    };
  })();

  return (
    <div className={`app ${fullscreen ? "fullscreen" : ""}`}>
      <Sidebar
        index={index}
        filters={filters}
        onChange={sidebarChange}
        matches={matchesForMap}
        counts={counts}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      {drawerOpen && <div className="scrim" onClick={() => setDrawerOpen(false)} />}
      <main className="main">
        <div className="topbar">
          <button className="icon-btn drawer-open" onClick={() => setDrawerOpen(true)} aria-label="Open filters">
            <IconMenu />
            <span>Filters</span>
          </button>
          <div className="crumbs">
            <span className="crumb">{MAP_LABELS[mapInfo.id]}</span>
            <span className="sep">/</span>
            <span className="crumb">{filters.date === "all" ? "All dates" : dateLabel(filters.date)}</span>
            <span className="sep">/</span>
            <span className="crumb strong">{selectedMatch ? matchLabel(selectedMatch) : `${matchesForMap.length} matches`}</span>
          </div>
          <div className="stats">
            {CATEGORIES.filter((c) => c !== "loot").map((c) => (
              <span key={c} className={`stat-chip ${c}`}>
                <b>{counts[c].toLocaleString()}</b> {c === "kill" ? "kills" : c === "death" ? "deaths" : "storm"}
              </span>
            ))}
          </div>
          <div className="actions" data-tour="actions">
            <button className="icon-btn" onClick={copyLink} title="Copy a link to this exact view" aria-label="Copy link">
              <IconLink />
              <span className="btn-label">{copied ? "Copied!" : "Share"}</span>
            </button>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle light or dark mode"
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <button className="icon-btn" onClick={startTour} title="Guided tour" aria-label="Open guided tour">
              <IconHelp />
              <span className="btn-label">Guide</span>
            </button>
          </div>
        </div>

        <QuestionBar active={lens} onPick={pickLens} />

        <div className="stage">
          {mapData ? (
            <MapView
              imageUrl={`/${mapInfo.image}`}
              mapSize={index.mapSize}
              journeys={journeys}
              events={visibleEvents}
              showPaths={filters.paths}
              time={t}
              singleMatch={singleMatch}
              heat={heat}
              hotspots={hotspots}
              focus={focus}
              backdrop={backdrop}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onOpenMatch={openMatch}
            />
          ) : (
            <div className="map-wrap">
              <div className="map-loading">
                {mapError ? (
                  <div className="load-msg">
                    <b>Couldn't load {MAP_LABELS[filters.mapId]}</b>
                    <span>{mapError}. Check your connection and try again.</span>
                    <button className="btn primary" onClick={retryMap}>Retry</button>
                  </div>
                ) : (
                  <div className="load-msg">
                    <span className="spinner" aria-hidden />
                    <span>Loading {MAP_LABELS[filters.mapId]}…</span>
                    {slowLoad && (
                      <>
                        <span className="muted-s">This is taking longer than usual (slow connection?).</span>
                        <button className="btn" onClick={retryMap}>Retry</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <InsightPanel
            title={panel.title}
            seeing={panel.seeing}
            facts={panel.facts}
            hotspots={hotspots}
            hotspotNoun={panel.noun}
            next={panel.next}
            story={story}
            time={t}
            onFocus={focusOn}
            onSeek={seekTo}
          />
        </div>

        <Timeline
          time={t}
          max={maxTime}
          playing={playing}
          speed={speed}
          singleMatch={singleMatch}
          ticks={ticks}
          onTime={(v) => {
            setPlaying(false);
            setTime(v >= maxTime ? Infinity : v);
          }}
          onPlay={togglePlay}
          onSpeed={setSpeed}
        />
      </main>
      {showWelcome && !tourOpen && <WelcomeCard onStart={startTour} onDismiss={dismissWelcome} />}
      <Tour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
          if (isMobile) setDrawerOpen(false);
        }}
        onStep={onTourStep}
      />
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
