// App = state + wiring. Data loading, playback, derived view data, URL handling and the panel text
// live in hooks/ and lib/; this file decides what is selected and passes it to the components.
import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import QuestionBar from "./components/QuestionBar";
import MapView, { type FocusRequest } from "./components/MapView";
import MapLoading from "./components/MapLoading";
import InsightPanel from "./components/InsightPanel";
import Timeline from "./components/Timeline";
import Tour, { WelcomeCard, type TourStep } from "./components/Tour";
import { useMapData } from "./hooks/useMapData";
import { usePlayback } from "./hooks/usePlayback";
import { useViewModel } from "./hooks/useViewModel";
import { useFullscreen } from "./hooks/useFullscreen";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useTheme } from "./lib/theme";
import { loadIndex } from "./lib/data";
import { lensById, type LensId } from "./lib/lenses";
import { describeView } from "./lib/panel";
import { readUrlState, sanitizeView, toQueryString, withHeatmapRule } from "./lib/viewState";
import type { Moment } from "./lib/insights";
import type { DataIndex, Filters } from "./lib/types";
import { MAP_LABELS, dateLabel, matchLabel } from "./lib/format";

const TOUR_SEEN_KEY = "lila.tourSeen";

export default function App() {
  // --- state -----------------------------------------------------------------------
  const [init] = useState(() => readUrlState(window.location.search));
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [lens, setLens] = useState<LensId | null>(init.lens);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem(TOUR_SEEN_KEY));
  const [theme, toggleTheme] = useTheme();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const isMobile = useMediaQuery("(max-width: 900px)");

  // --- data --------------------------------------------------------------------------
  useEffect(() => {
    loadIndex()
      .then((idx) => {
        // validate the map/date/match from the URL before anything is fetched with them
        const clean = sanitizeView(init, idx);
        setFilters((f) => ({ ...f, ...clean.filters }));
        setLens(clean.lens);
        setIndex(idx);
      })
      .catch((e: Error) => setIndexError(e.message));
  }, [init]);

  const { mapData, error: mapError, slow: mapSlow, retry: retryMap } = useMapData(index, filters.mapId);

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
  const maxTime = useMemo(
    () => matchesForMap.filter((m) => selectedIds.has(m.id)).reduce((mx, m) => Math.max(mx, m.duration), 0),
    [matchesForMap, selectedIds],
  );

  const playback = usePlayback(maxTime);
  const view = useViewModel({ index, mapData, filters, selectedIds, singleMatch, t: playback.t });

  // keep the URL in sync so the address bar is always a shareable link to this view
  useEffect(() => {
    window.history.replaceState(null, "", toQueryString({ filters, lens }));
  }, [filters, lens]);

  // on phones, close the drawer after picking a match so the map is visible
  useEffect(() => {
    if (isMobile) setDrawerOpen(false);
  }, [filters.matchId, isMobile]);

  // --- actions ------------------------------------------------------------------------
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...withHeatmapRule(f, patch) }));
    if ("mapId" in patch || "date" in patch || "matchId" in patch) playback.reset();
  };

  const openMatch = (id: string) => {
    update({ ...lensById("replay")!.patch, matchId: id });
    setLens("replay");
  };

  /** Sidebar changes. Map/date keep the current question; anything else makes it a custom view. */
  const sidebarChange = (patch: Partial<Filters>) => {
    if (patch.matchId !== undefined && patch.matchId !== "all") return openMatch(patch.matchId);
    const scopeOnly = Object.keys(patch).every((k) => k === "mapId" || k === "date" || k === "matchId");
    const leavesMatch = lens === "replay" && (patch.matchId === "all" || "mapId" in patch || "date" in patch);
    if (!scopeOnly || leavesMatch) setLens(null);
    update(patch);
  };

  const pickLens = (id: LensId) => {
    const l = lensById(id)!;
    setLens(id);
    if (id !== "replay") return update(l.patch);
    // "What happens in a match?": replay the open match, or the most eventful one in the selection
    const match =
      filters.matchId !== "all"
        ? filters.matchId
        : [...matchesForMap].sort((a, b) => b.kills + b.deaths + b.storm - (a.kills + a.deaths + a.storm))[0]?.id;
    if (!match) return;
    update({ ...l.patch, matchId: match });
    playback.playFromStart();
  };

  const focusOn = (x: number, y: number, zoom: number) => setFocus({ x, y, zoom, nonce: Date.now() });
  const seekToMoment = (m: Moment) => {
    playback.seek(m.t);
    focusOn(m.ev.x, m.ev.y, 2.5);
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
  const onTourStep = (step: TourStep) => isMobile && setDrawerOpen(!!step.inSidebar);

  // --- render -----------------------------------------------------------------------
  if (indexError) return <div className="splash error">Could not load data: {indexError}</div>;
  if (!index) return <div className="splash">Loading telemetry…</div>;

  const mapInfo = index.maps.find((m) => m.id === filters.mapId) ?? index.maps[0];
  const mapName = MAP_LABELS[mapInfo.id] ?? mapInfo.id;
  const selectedMatch = singleMatch ? index.matches.find((m) => m.id === filters.matchId) : undefined;
  const panel = describeView({
    lens: lensById(lens),
    match: selectedMatch,
    filters,
    matchCount: matchesForMap.length,
    dateText: filters.date === "all" ? "Feb 10–14" : dateLabel(filters.date),
    stats: view.stats,
    subjectKind: view.subjectKind,
  });

  return (
    <div className={`app ${fullscreen ? "fullscreen" : ""}`}>
      <Sidebar
        index={index}
        filters={filters}
        onChange={sidebarChange}
        matches={matchesForMap}
        counts={view.counts}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      {drawerOpen && <div className="scrim" onClick={() => setDrawerOpen(false)} />}

      <main className="main">
        <TopBar
          crumbs={[
            mapName,
            filters.date === "all" ? "All dates" : dateLabel(filters.date),
            selectedMatch ? matchLabel(selectedMatch) : `${matchesForMap.length} matches`,
          ]}
          counts={view.counts}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenGuide={startTour}
          onOpenFilters={() => setDrawerOpen(true)}
        />
        <QuestionBar active={lens} onPick={pickLens} />

        <div className="stage">
          {mapData ? (
            <MapView
              imageUrl={`/${mapInfo.image}`}
              mapSize={index.mapSize}
              journeys={view.journeys}
              events={view.visibleEvents}
              showPaths={filters.paths}
              time={playback.t}
              singleMatch={singleMatch}
              heat={view.heat}
              hotspots={view.hotspots}
              focus={focus}
              theme={theme}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onOpenMatch={openMatch}
            />
          ) : (
            <MapLoading mapName={mapName} error={mapError} slow={mapSlow} onRetry={retryMap} />
          )}
          <InsightPanel
            title={panel.title}
            seeing={panel.seeing}
            facts={panel.facts}
            hotspots={view.hotspots}
            hotspotNoun={panel.hotspotNoun}
            next={panel.next}
            story={view.story}
            time={playback.t}
            onFocus={focusOn}
            onSeek={seekToMoment}
          />
        </div>

        <Timeline
          time={playback.t}
          max={maxTime}
          playing={playback.playing}
          speed={playback.speed}
          singleMatch={singleMatch}
          ticks={view.ticks}
          onTime={playback.seek}
          onPlay={playback.togglePlay}
          onSpeed={playback.setSpeed}
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
